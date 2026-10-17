import { type PluginListenerHandle, registerPlugin } from '@capacitor/core';
import { ProjectSpaceError } from '../projects/errors';
import { basename, isWithin, joinPath, parentPath, resolveInRoot } from '../projects/paths';
import { canBeProject, GIT_DIR, isRepository, MARKER_DIR } from '../projects/projects';
import type { FsEvents } from '../projects/observed';
import type { ProjectSpace } from '../projects/projectSpace';
import { applyExclusion, diffTexts, type FileDiff, type LineExclusion } from './diff';

/*
 * The git engine (ADR-006): what the UI asks git for, without knowing what
 * runs underneath. On Android it is JGit in the native `Git` plugin; on the
 * web (`npm run dev`) and in tests a small stand-in on the project space.
 * Repository paths are project folders, relative to the space root like
 * everywhere else; the paths of the files in a repository are relative to it.
 */
export const DEFAULT_BRANCH = 'main';

export interface RepoInfo {
  /** The current branch (HEAD's), e.g. "main". */
  branch: string;
  /** False until the first commit. */
  hasCommits: boolean;
}

/** How a file differs from the last commit. */
export type ChangeKind = 'new' | 'modified' | 'deleted' | 'conflicted';

export interface FileChange {
  /** Relative to the repository. */
  path: string;
  kind: ChangeKind;
}

/** Who commits: the app's own git identity (Sprint 4 takes it from GitHub). */
export interface Identity {
  name: string;
  email: string;
}

export interface CommitResult {
  /** Short id, e.g. "3f2a91c". */
  id: string;
  summary: string;
}

/** A commit in the history. */
export interface LogEntry {
  /** The full id; [shortId] shows. */
  id: string;
  /** The message's first line. */
  summary: string;
  /** The rest of the message, maybe empty. */
  description: string;
  author: string;
  email: string;
  /** When it was written, in millis since the epoch. */
  time: number;
}

/**
 * The branch's last commit (#140): whether GitHub has it already, on any of
 * its branches as of the last fetch (then it can no longer be undone), and
 * whether it is a merge (never undone either).
 */
export interface LastCommit {
  commit: LogEntry;
  onGitHub: boolean;
  merge: boolean;
}

/** A branch's stashed changes (#139): when they were stashed, and the files. */
export interface StashInfo {
  branch: string;
  time: number;
  files: FileChange[];
}

/** A snapshot holding one version of a file: when it was taken, and why. */
export interface SnapshotVersion {
  id: string;
  reason: string;
  time: number;
}

/** How many commits the history reads at a time. */
export const LOG_PAGE = 50;

/** "3f2a91c": how a commit is named on screen. */
export const shortId = (id: string): string => id.slice(0, 7);

export interface Branch {
  name: string;
  /** The branch HEAD is on. */
  current: boolean;
  /** Only on GitHub (origin/[name]) so far: switching to it makes the local branch. */
  remote?: true;
}

/**
 * A git failure the UI handles: switching branch would overwrite uncommitted
 * changes to [paths] (CONFLICT), a branch to delete has commits on no other
 * branch (NOT_MERGED), [paths] changed after their lines were picked for a
 * commit (STALE); or talking to GitHub (#32, #33): the user stopped it
 * (CANCELLED), GitHub refused the sign-in (UNAUTHORIZED), no connection
 * (NETWORK), a pull would merge both sides' changes into the same lines of
 * [paths] (MERGE_CONFLICT), a push found commits on GitHub this branch does
 * not have (REJECTED). Pulling with uncommitted changes to [paths] in the
 * way is a CONFLICT, as when switching branch. The commit to undo is on
 * GitHub already (PUSHED, #140).
 */
export type GitErrorCode =
  | 'CONFLICT'
  | 'NOT_MERGED'
  | 'STALE'
  | 'CANCELLED'
  | 'UNAUTHORIZED'
  | 'NETWORK'
  | 'MERGE_CONFLICT'
  | 'REJECTED'
  | 'PUSHED';

const GIT_ERROR_CODES: readonly GitErrorCode[] = [
  'CONFLICT',
  'NOT_MERGED',
  'STALE',
  'CANCELLED',
  'UNAUTHORIZED',
  'NETWORK',
  'MERGE_CONFLICT',
  'REJECTED',
  'PUSHED',
];

/**
 * Where the current branch stands against GitHub's, as of the last fetch:
 * whether the repository has GitHub as its origin ([remote]), the branch it
 * follows there ("origin/main"; null when it is not on GitHub yet), how
 * many commits each side has that the other does not, and when that fetch
 * was ([lastFetched], in millis since the epoch; null when never).
 */
export interface SyncState {
  remote: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  lastFetched: number | null;
}

/** The commits behind [SyncState]'s counts (#35), newest first: GitHub's to pull, and the branch's to push. */
export interface SyncCommits {
  toPull: LogEntry[];
  toPush: LogEntry[];
}

/** How many of each side [GitEngine.syncCommits] lists; the counts say how many more. */
export const SYNC_COMMITS = 100;

/** How a clone, fetch, pull or push goes: the step git is on ("Receiving objects"…), and how far; [total] is 0 when unknown. */
export interface RemoteProgress {
  task: string;
  done: number;
  total: number;
}

export class GitError extends Error {
  constructor(
    readonly code: GitErrorCode,
    message: string,
    readonly paths: readonly string[] = [],
  ) {
    super(message);
    this.name = 'GitError';
  }
}

export interface GitEngine {
  isRepository(path: string): Promise<boolean>;
  /** Makes the folder at [path] a repository on [DEFAULT_BRANCH]; an existing one is left as it is. */
  init(path: string): Promise<RepoInfo>;
  /** The repository at [path], or null when it is not one. */
  info(path: string): Promise<RepoInfo | null>;
  /** Every file that differs from the last commit, sorted by path. */
  status(path: string): Promise<FileChange[]>;
  /** How [file] (repo-relative) differs from the last commit, like status: the file on disk against it. */
  diff(path: string, file: string): Promise<FileDiff>;
  /**
   * Commits exactly [paths] as they are on disk (a missing one is a deletion),
   * like GitHub Desktop's ticked files: whatever was staged before is left out.
   * The files in [excluded] go without the changed lines picked there; when
   * one changed since, nothing is committed (a STALE [GitError]).
   * With [amend], GitHub Desktop's Amend (#141): the last commit is replaced
   * by one with [message] and its changes plus [paths] (none: just the
   * message), keeping its author. Never a commit on GitHub (PUSHED) or a merge.
   */
  commit(
    path: string,
    commit: {
      message: string;
      paths: readonly string[];
      excluded?: Readonly<Record<string, LineExclusion>>;
      amend?: boolean;
    },
  ): Promise<CommitResult>;
  /**
   * GitHub Desktop's Discard changes (#138): [paths] go back to the last
   * commit (a new file is deleted, a deleted one comes back); for those in
   * [lines], only the changed lines picked there, the rest stays. A snapshot
   * is taken first, so Earlier versions keeps what was discarded. When a
   * file changed since its lines were picked, nothing is discarded (STALE).
   */
  discard(
    path: string,
    change: { paths: readonly string[]; lines?: Readonly<Record<string, LineExclusion>> },
  ): Promise<void>;
  /** The current branch's stashed changes (#139), or null. One per branch, as GitHub Desktop keeps them. */
  stash(path: string): Promise<StashInfo | null>;
  /**
   * GitHub Desktop's Stash all changes: every uncommitted change, new files
   * too, set aside for this branch, which is left as its last commit. It
   * replaces a stash the branch had. A snapshot is taken first.
   */
  stashChanges(path: string): Promise<StashInfo>;
  /**
   * Brings the branch's stashed changes back and drops the stash. Only onto
   * a branch without changes (CONFLICT, with the files in the way); when they
   * no longer fit the branch's newer commits, nothing changes and the stash stays.
   */
  restoreStash(path: string): Promise<void>;
  /** Throws the branch's stashed changes away. */
  dropStash(path: string): Promise<void>;
  /** The current branch's last commit (#140), or null before the first one. */
  lastCommit(path: string): Promise<LastCommit | null>;
  /**
   * GitHub Desktop's Undo: the branch goes back to the commit before its
   * last one, whose changes are uncommitted again (the files stay as they
   * are). Undoing the first commit leaves the branch with none. Never a
   * commit on GitHub (PUSHED) or a merge. Returns the commit undone, for
   * its message.
   */
  undoCommit(path: string): Promise<LogEntry>;
  /**
   * GitHub Desktop's Revert (#142): a new commit that undoes what [commit]
   * changed, safe even when GitHub has it. When later commits changed the
   * same lines, nothing changes (MERGE_CONFLICT, with the files); nor when
   * uncommitted changes to those files are in the way (CONFLICT). The files
   * it rewrites are announced as fs.* events. Never a merge commit.
   */
  revert(path: string, commit: string): Promise<CommitResult>;
  /** The commits reachable from HEAD, newest first: [limit] after skipping [skip]. None before the first commit. */
  log(path: string, page?: { skip?: number; limit?: number }): Promise<LogEntry[]>;
  /** The files [commit] changed against its first parent (all new in a first commit), sorted by path. */
  commitChanges(path: string, commit: string): Promise<FileChange[]>;
  /** How [file] changed in [commit]: its first parent's version against the commit's. */
  commitDiff(path: string, commit: string, file: string): Promise<FileDiff>;
  /**
   * Records the working tree as it is on disk (every file not ignored,
   * untracked ones too) as a snapshot on Pepino's own ref, which no branch,
   * History or push shows; nothing new when nothing changed since the last.
   * Branch switches take one by themselves first. Returns its id.
   */
  snapshot(path: string, reason: string): Promise<string>;
  /** The versions of [file] in the snapshots, newest first; one that repeats the newer one is left out. */
  snapshotVersions(path: string, file: string): Promise<SnapshotVersion[]>;
  /** [file] as snapshot [id] has it, or null when it was not there. */
  snapshotFile(path: string, id: string, file: string): Promise<string | null>;
  /** The identity commits are made with, or null until it is set. */
  identity(): Promise<Identity | null>;
  setIdentity(identity: Identity): Promise<void>;
  /**
   * The local branches by name (with no commits yet, just the unborn current
   * one), then GitHub's that are not local yet ([Branch.remote]).
   */
  branches(path: string): Promise<Branch[]>;
  /** Creates [name] at the current commit and switches to it; uncommitted changes come along. */
  createBranch(path: string, name: string): Promise<RepoInfo>;
  /**
   * Switches to [name] (a remote one gets its local branch first), rewriting
   * the files that differ (announced as fs.* events). Rejects with a CONFLICT
   * [GitError] when uncommitted changes would be overwritten; nothing changes
   * then.
   */
  checkout(path: string, name: string): Promise<RepoInfo>;
  /** Deletes [name] (never the current branch); NOT_MERGED unless [force] when its commits are on no other branch. */
  deleteBranch(path: string, name: string, options?: { force?: boolean }): Promise<void>;
  /**
   * Clones the GitHub repository at [url] into [path], a new or empty folder,
   * on its default branch, with the signed-in user's token (which stays
   * native). [onProgress] follows it. A failed or cancelled clone leaves
   * nothing behind; [cancelRemote] makes it reject with CANCELLED.
   */
  clone(path: string, url: string, onProgress?: (progress: RemoteProgress) => void): Promise<RepoInfo>;
  /** Stops the clone, fetch, pull or push in progress: it rejects with CANCELLED. */
  cancelRemote(): Promise<void>;
  /** Where the current branch stands against GitHub's, as of the last fetch (no network). */
  sync(path: string): Promise<SyncState>;
  /** The URL of the repository's origin (GitHub's, for a clone), or null. */
  originUrl(path: string): Promise<string | null>;
  /** The commits to pull and to push, as of the last fetch (no network); none for a branch not on GitHub. */
  syncCommits(path: string): Promise<SyncCommits>;
  /** Brings GitHub's branches up to date, touching no local branch or file. */
  fetch(path: string, onProgress?: (progress: RemoteProgress) => void): Promise<SyncState>;
  /**
   * Fetches and brings GitHub's new commits into the current branch (a
   * fast-forward, or a merge commit), rewriting the files that change
   * (announced as fs.* events). Nothing changes when it would conflict
   * (MERGE_CONFLICT) or uncommitted changes are in the way (CONFLICT).
   */
  pull(path: string, onProgress?: (progress: RemoteProgress) => void): Promise<SyncState>;
  /**
   * Pushes the current branch to GitHub; one not there yet is published and
   * follows it from then on. REJECTED when GitHub has commits it does not.
   */
  push(path: string, onProgress?: (progress: RemoteProgress) => void): Promise<SyncState>;
}

interface GitPlugin {
  isRepository(options: { path: string }): Promise<{ repository: boolean }>;
  init(options: { path: string }): Promise<RepoInfo>;
  info(options: { path: string }): Promise<{ info: RepoInfo | null }>;
  status(options: { path: string }): Promise<{ changes: FileChange[] }>;
  diff(options: { path: string; file: string }): Promise<FileDiff>;
  commit(options: {
    path: string;
    message: string;
    paths: string[];
    excluded: Record<string, LineExclusion>;
    amend: boolean;
  }): Promise<CommitResult>;
  discard(options: {
    path: string;
    paths: string[];
    lines: Record<string, LineExclusion>;
  }): Promise<{ written: string[]; removed: string[] }>;
  stash(options: { path: string }): Promise<{ stash: StashInfo | null }>;
  stashChanges(options: { path: string }): Promise<{ stash: StashInfo; written: string[]; removed: string[] }>;
  restoreStash(options: { path: string }): Promise<{ written: string[]; removed: string[] }>;
  dropStash(options: { path: string }): Promise<void>;
  lastCommit(options: { path: string }): Promise<{ last: LastCommit | null }>;
  undoCommit(options: { path: string }): Promise<{ commit: LogEntry }>;
  revert(options: {
    path: string;
    commit: string;
  }): Promise<{ commit: CommitResult; written: string[]; removed: string[] }>;
  log(options: { path: string; skip: number; limit: number }): Promise<{ commits: LogEntry[] }>;
  commitChanges(options: { path: string; commit: string }): Promise<{ changes: FileChange[] }>;
  commitDiff(options: { path: string; commit: string; file: string }): Promise<FileDiff>;
  snapshot(options: { path: string; reason: string }): Promise<{ id: string }>;
  snapshotVersions(options: { path: string; file: string }): Promise<{ versions: SnapshotVersion[] }>;
  snapshotFile(options: { path: string; id: string; file: string }): Promise<{ text: string | null }>;
  identity(): Promise<{ identity: Identity | null }>;
  setIdentity(options: Identity): Promise<void>;
  branches(options: { path: string }): Promise<{ branches: Branch[] }>;
  createBranch(options: { path: string; name: string }): Promise<RepoInfo>;
  checkout(options: { path: string; name: string }): Promise<{ info: RepoInfo; written: string[]; removed: string[] }>;
  deleteBranch(options: { path: string; name: string; force: boolean }): Promise<void>;
  clone(options: { path: string; url: string }): Promise<RepoInfo>;
  cancelRemote(): Promise<void>;
  sync(options: { path: string }): Promise<SyncState>;
  syncCommits(options: { path: string; limit: number }): Promise<SyncCommits>;
  originUrl(options: { path: string }): Promise<{ url: string | null }>;
  fetch(options: { path: string }): Promise<SyncState>;
  pull(options: { path: string }): Promise<{ state: SyncState; written: string[]; removed: string[] }>;
  push(options: { path: string }): Promise<SyncState>;
  addListener(event: 'remoteProgress', listener: (progress: RemoteProgress) => void): Promise<PluginListenerHandle>;
}

const project = (path: string): string => {
  if (!canBeProject(path)) throw new ProjectSpaceError('InvalidName', 'The project space is not a project');
  return resolveInRoot(path);
};

/** The first line of a commit message. */
export const summaryOf = (message: string): string => message.trim().split('\n')[0].trim();

type Announce = <K extends keyof FsEvents>(topic: K, payload: FsEvents[K]) => void;

/** A plugin rejection with a code the UI handles, as a [GitError]; anything else as it is. */
function gitError(error: unknown): unknown {
  const { code, message, data } = (error ?? {}) as { code?: string; message?: string; data?: { paths?: string[] } };
  const known = GIT_ERROR_CODES.find((candidate) => candidate === code);
  if (known) return new GitError(known, message ?? known, data?.paths ?? []);
  return error;
}

/**
 * JGit through the native plugin. It writes straight to disk, past the
 * project space, so what it changes (a new `.git`, the files a branch switch
 * rewrites) is announced through [announce] for the explorer, the tree and
 * the editor to follow.
 */
export function createNativeGitEngine(announce: Announce): GitEngine {
  const git = registerPlugin<GitPlugin>('Git');
  return {
    async isRepository(path) {
      return (await git.isRepository({ path: project(path) })).repository;
    },
    async init(path) {
      const folder = project(path);
      const existed = (await git.isRepository({ path: folder })).repository;
      const info = await git.init({ path: folder });
      if (!existed) announce('fs.created', { path: joinPath(folder, GIT_DIR) });
      return info;
    },
    async info(path) {
      return (await git.info({ path: project(path) })).info;
    },
    async status(path) {
      return (await git.status({ path: project(path) })).changes;
    },
    diff(path, file) {
      return git.diff({ path: project(path), file });
    },
    commit(path, { message, paths, excluded = {}, amend = false }) {
      return git
        .commit({ path: project(path), message, paths: [...paths], excluded: { ...excluded }, amend })
        .catch((error: unknown) => {
          throw gitError(error);
        });
    },
    async discard(path, { paths, lines = {} }) {
      const folder = project(path);
      const discarded = await git
        .discard({ path: folder, paths: [...paths], lines: { ...lines } })
        .catch((error: unknown) => {
          throw gitError(error);
        });
      for (const file of discarded.written) announce('fs.written', { path: joinPath(folder, file) });
      for (const file of discarded.removed) announce('fs.deleted', { path: joinPath(folder, file) });
    },
    async stash(path) {
      return (await git.stash({ path: project(path) })).stash;
    },
    async stashChanges(path) {
      const folder = project(path);
      const stashed = await git.stashChanges({ path: folder }).catch((error: unknown) => {
        throw gitError(error);
      });
      for (const file of stashed.written) announce('fs.written', { path: joinPath(folder, file) });
      for (const file of stashed.removed) announce('fs.deleted', { path: joinPath(folder, file) });
      return stashed.stash;
    },
    async restoreStash(path) {
      const folder = project(path);
      const restored = await git.restoreStash({ path: folder }).catch((error: unknown) => {
        throw gitError(error);
      });
      for (const file of restored.written) announce('fs.written', { path: joinPath(folder, file) });
      for (const file of restored.removed) announce('fs.deleted', { path: joinPath(folder, file) });
    },
    async dropStash(path) {
      await git.dropStash({ path: project(path) }).catch((error: unknown) => {
        throw gitError(error);
      });
    },
    async lastCommit(path) {
      return (await git.lastCommit({ path: project(path) })).last;
    },
    async revert(path, commit) {
      const folder = project(path);
      const reverted = await git.revert({ path: folder, commit }).catch((error: unknown) => {
        throw gitError(error);
      });
      for (const file of reverted.written) announce('fs.written', { path: joinPath(folder, file) });
      for (const file of reverted.removed) announce('fs.deleted', { path: joinPath(folder, file) });
      return reverted.commit;
    },
    async undoCommit(path) {
      const undone = await git.undoCommit({ path: project(path) }).catch((error: unknown) => {
        throw gitError(error);
      });
      return undone.commit;
    },
    async log(path, { skip = 0, limit = LOG_PAGE } = {}) {
      return (await git.log({ path: project(path), skip, limit })).commits;
    },
    async commitChanges(path, commit) {
      return (await git.commitChanges({ path: project(path), commit })).changes;
    },
    commitDiff(path, commit, file) {
      return git.commitDiff({ path: project(path), commit, file });
    },
    async snapshot(path, reason) {
      return (await git.snapshot({ path: project(path), reason })).id;
    },
    async snapshotVersions(path, file) {
      return (await git.snapshotVersions({ path: project(path), file })).versions;
    },
    async snapshotFile(path, id, file) {
      return (await git.snapshotFile({ path: project(path), id, file })).text;
    },
    async identity() {
      return (await git.identity()).identity;
    },
    setIdentity(identity) {
      return git.setIdentity(identity);
    },
    async branches(path) {
      return (await git.branches({ path: project(path) })).branches;
    },
    createBranch(path, name) {
      return git.createBranch({ path: project(path), name });
    },
    async checkout(path, name) {
      const folder = project(path);
      const switched = await git.checkout({ path: folder, name }).catch((error: unknown) => {
        throw gitError(error);
      });
      for (const file of switched.written) announce('fs.written', { path: joinPath(folder, file) });
      for (const file of switched.removed) announce('fs.deleted', { path: joinPath(folder, file) });
      return switched.info;
    },
    async deleteBranch(path, name, { force = false } = {}) {
      await git.deleteBranch({ path: project(path), name, force }).catch((error: unknown) => {
        throw gitError(error);
      });
    },
    async clone(path, url, onProgress) {
      const folder = project(path);
      const info = await remote(onProgress, () => git.clone({ path: folder, url }));
      announce('fs.created', { path: folder });
      return info;
    },
    cancelRemote() {
      return git.cancelRemote();
    },
    sync(path) {
      return git.sync({ path: project(path) });
    },
    async originUrl(path) {
      return (await git.originUrl({ path: project(path) })).url;
    },
    syncCommits(path) {
      return git.syncCommits({ path: project(path), limit: SYNC_COMMITS });
    },
    fetch(path, onProgress) {
      const folder = project(path);
      return remote(onProgress, () => git.fetch({ path: folder }));
    },
    async pull(path, onProgress) {
      const folder = project(path);
      const pulled = await remote(onProgress, () => git.pull({ path: folder }));
      for (const file of pulled.written) announce('fs.written', { path: joinPath(folder, file) });
      for (const file of pulled.removed) announce('fs.deleted', { path: joinPath(folder, file) });
      return pulled.state;
    },
    push(path, onProgress) {
      const folder = project(path);
      return remote(onProgress, () => git.push({ path: folder }));
    },
  };

  /** Runs a remote operation, following its progress while it lasts; its errors as [GitError]s. */
  async function remote<T>(onProgress: ((progress: RemoteProgress) => void) | undefined, run: () => Promise<T>) {
    const listening = onProgress ? await git.addListener('remoteProgress', onProgress) : null;
    try {
      return await run().catch((error: unknown) => {
        throw gitError(error);
      });
    } finally {
      await listening?.remove();
    }
  }
}

/** Folders the stand-in never looks into: git's and Pepino's own, and dependencies. */
const SKIPPED = new Set([GIT_DIR, MARKER_DIR, 'node_modules']);

/** A branch name git would accept, roughly (the stand-in only). */
const isValidBranchName = (name: string) =>
  /^[A-Za-z0-9._/-]+$/.test(name) && !name.startsWith('-') && !name.includes('..') && !name.endsWith('/');

type Snapshot = Record<string, string>;

/** Bigger files are committed whole, never shown line by line (as on Android). */
const DIFF_MAX_CHARS = 1 << 20;

/** A short FNV-1a hash: the stand-in's diff version. */
const hashOf = (text: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(16);
};

/**
 * A stand-in for the web and tests: a repository is a `.git` folder whose
 * HEAD names the branch, and each branch's last commit is a copy of its files
 * in `.git/pepino-refs.json`. Enough to try the GIT screens with
 * `npm run dev`; the real thing is JGit, tested in JUnit (ADR-006).
 */
export function createMemoryGitEngine(space: ProjectSpace, { cloneStepMs = 250 } = {}): GitEngine {
  let identity: Identity | null = null;
  let commits = 0;
  let remoteCancelled = false;
  const gitPath = (folder: string, name: string) => joinPath(joinPath(folder, GIT_DIR), name);

  const readRefs = async (folder: string): Promise<Record<string, Snapshot>> => {
    const raw = await space.readTextFile(gitPath(folder, 'pepino-refs.json')).catch(() => '{}');
    return JSON.parse(raw) as Record<string, Snapshot>;
  };
  const writeRefs = (folder: string, refs: Record<string, Snapshot>) =>
    space.writeTextFile(gitPath(folder, 'pepino-refs.json'), JSON.stringify(refs));
  /** GitHub's branches (origin/…) in a clone, as each one's files. */
  const readRemotes = async (folder: string): Promise<Record<string, Snapshot>> => {
    const raw = await space.readTextFile(gitPath(folder, 'pepino-remotes.json')).catch(() => '{}');
    return JSON.parse(raw) as Record<string, Snapshot>;
  };
  const writeRemotes = (folder: string, remotes: Record<string, Snapshot>) =>
    space.writeTextFile(gitPath(folder, 'pepino-remotes.json'), JSON.stringify(remotes));

  /** Each branch's commits, newest first, with the files as each one left them. */
  type Log = Record<string, (LogEntry & { files: Snapshot })[]>;
  const readLog = async (folder: string): Promise<Log> => {
    const raw = await space.readTextFile(gitPath(folder, 'pepino-log.json')).catch(() => '{}');
    return JSON.parse(raw) as Log;
  };
  const writeLog = (folder: string, log: Log) =>
    space.writeTextFile(gitPath(folder, 'pepino-log.json'), JSON.stringify(log));

  /** Whether one of GitHub's branches (origin/… in the log) has commit [id]. */
  const onGitHub = (log: Log, id: string) =>
    Object.entries(log).some(
      ([name, entries]) => name.startsWith('origin/') && entries.some((entry) => entry.id === id),
    );

  /** Stashed changes by branch: each file as stashed (null: deleted), and as the branch had it then. */
  type StashedFiles = {
    time: number;
    changes: FileChange[];
    files: Record<string, string | null>;
    base: Record<string, string | null>;
  };
  const readStashes = async (folder: string): Promise<Record<string, StashedFiles>> => {
    const raw = await space.readTextFile(gitPath(folder, 'pepino-stashes.json')).catch(() => '{}');
    return JSON.parse(raw) as Record<string, StashedFiles>;
  };
  const writeStashes = (folder: string, stashes: Record<string, StashedFiles>) =>
    space.writeTextFile(gitPath(folder, 'pepino-stashes.json'), JSON.stringify(stashes));

  /** The snapshots, newest first, each with the files as they were. */
  type Snapshots = (SnapshotVersion & { files: Snapshot })[];
  const readSnapshots = async (folder: string): Promise<Snapshots> => {
    const raw = await space.readTextFile(gitPath(folder, 'pepino-snapshots.json')).catch(() => '[]');
    return JSON.parse(raw) as Snapshots;
  };

  /** The commit [id] (or a prefix of it) on any branch, and the files of its parent. */
  const findCommit = async (folder: string, id: string) => {
    for (const commits of Object.values(await readLog(folder))) {
      const at = commits.findIndex((commit) => id.length >= 4 && commit.id.startsWith(id));
      if (at >= 0) return { files: commits[at].files, parent: commits[at + 1]?.files ?? {} };
    }
    throw new Error(`No commit ${id}`);
  };

  const currentBranch = async (folder: string): Promise<string> => {
    const head = (await space.readTextFile(gitPath(folder, 'HEAD')).catch(() => '')).trim();
    const ref = 'ref: refs/heads/';
    return head.startsWith(ref) ? head.slice(ref.length) : 'HEAD';
  };
  const setCurrentBranch = (folder: string, name: string) =>
    space.writeTextFile(gitPath(folder, 'HEAD'), `ref: refs/heads/${name}\n`);

  /** Every file of the project (relative path → text), skipping [SKIPPED] folders. */
  const readFiles = async (folder: string): Promise<Map<string, string>> => {
    const files = new Map<string, string>();
    const walk = async (dir: string, prefix: string) => {
      for (const entry of await space.listDirectory(dir)) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory) {
          if (!SKIPPED.has(entry.name)) await walk(entry.path, relative);
        } else {
          files.set(relative, await space.readTextFile(entry.path));
        }
      }
    };
    await walk(folder, '');
    return files;
  };

  const repository = async (path: string): Promise<string> => {
    const folder = project(path);
    if (!(await isRepository(space, folder))) throw new ProjectSpaceError('NotFound', `Not a repository: ${path}`);
    return folder;
  };

  /** Writes [path] (repo-relative), creating its folders. */
  const writeFile = async (folder: string, path: string, text: string) => {
    const dirs = parentPath(path).split('/').filter(Boolean);
    for (let i = 1; i <= dirs.length; i++) {
      await space.createDirectory(joinPath(folder, dirs.slice(0, i).join('/'))).catch(() => undefined);
    }
    await space.writeTextFile(joinPath(folder, path), text);
  };

  const engine: GitEngine = {
    isRepository: async (path) => isRepository(space, project(path)),

    async init(path) {
      const folder = project(path);
      if (!(await isRepository(space, folder))) {
        await space.createDirectory(joinPath(folder, GIT_DIR));
        await setCurrentBranch(folder, DEFAULT_BRANCH);
      }
      return (await engine.info(folder))!;
    },

    async info(path) {
      const folder = project(path);
      if (!(await isRepository(space, folder))) return null;
      const branch = await currentBranch(folder);
      return { branch, hasCommits: branch in (await readRefs(folder)) };
    },

    async status(path) {
      const folder = await repository(path);
      const [refs, branch, files] = await Promise.all([readRefs(folder), currentBranch(folder), readFiles(folder)]);
      const head = refs[branch] ?? {};
      const changes: FileChange[] = [];
      for (const [file, text] of files) {
        if (!(file in head)) changes.push({ path: file, kind: 'new' });
        else if (head[file] !== text) changes.push({ path: file, kind: 'modified' });
      }
      for (const file of Object.keys(head)) {
        if (!files.has(file)) changes.push({ path: file, kind: 'deleted' });
      }
      return changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    },

    async diff(path, file) {
      const folder = await repository(path);
      const target = resolveInRoot(joinPath(folder, file));
      if (target === folder || !isWithin(target, folder)) {
        throw new ProjectSpaceError('EscapesRoot', `Outside the repository: ${file}`);
      }
      const [refs, branch] = await Promise.all([readRefs(folder), currentBranch(folder)]);
      const before = refs[branch]?.[file] ?? '';
      const after = await space.readTextFile(target).catch(() => '');
      const version = `${hashOf(before)}:${hashOf(after)}`;
      if (before.length > DIFF_MAX_CHARS || after.length > DIFF_MAX_CHARS) {
        return { version: '', binary: false, tooLarge: true, hunks: [] };
      }
      return { version, binary: false, tooLarge: false, hunks: diffTexts(before, after) };
    },

    async commit(path, { message, paths, excluded = {}, amend = false }) {
      const folder = await repository(path);
      if (!identity) throw new Error('Set your name and email for commits first');
      if (paths.length === 0 && !amend) throw new Error('Choose at least one file to commit');
      const summary = summaryOf(message);
      if (!summary) throw new Error('A commit needs a summary');
      const [refs, branch, files, log] = await Promise.all([
        readRefs(folder),
        currentBranch(folder),
        readFiles(folder),
        readLog(folder),
      ]);
      // Amending: the commit replaced, which keeps its author
      const [amended, ...older] = amend ? (log[branch] ?? []) : [];
      if (amend && !amended) throw new Error('There is no commit yet');
      if (amended && onGitHub(log, amended.id)) {
        throw new GitError('PUSHED', `"${amended.summary}" is on GitHub already: amending it needs a force push`);
      }
      const head = refs[branch] ?? {};
      const stale = paths.filter((file) => {
        const exclusion = excluded[file];
        if (!exclusion || exclusion.lines.length === 0) return false;
        return exclusion.version !== `${hashOf(head[file] ?? '')}:${hashOf(files.get(file) ?? '')}`;
      });
      if (stale.length > 0) {
        throw new GitError('STALE', `${stale[0]} changed since you picked its lines: check them again`, stale);
      }
      const next = { ...head };
      for (const file of paths) {
        const exclusion = excluded[file];
        const text = files.get(file);
        if (exclusion && exclusion.lines.length > 0) {
          const partial = applyExclusion(head[file] ?? '', text ?? '', new Set(exclusion.lines));
          if (partial !== null) next[file] = partial;
        } else if (text === undefined) delete next[file];
        else next[file] = text;
      }
      if (!amend && branch in refs && JSON.stringify(next) === JSON.stringify(head)) {
        throw new Error('Those files have no changes to commit');
      }
      await writeRefs(folder, { ...refs, [branch]: next });
      commits += 1;
      const time = Date.now();
      const id = [0, 1, 2, 3, 4]
        .map((part) => hashOf(`${part}:${folder}:${branch}:${commits}:${time}:${message}`).padStart(8, '0'))
        .join('');
      const description = message.trim().split('\n').slice(1).join('\n').trim();
      const author = amended ?? { author: identity.name, email: identity.email };
      const entry = { id, summary, description, author: author.author, email: author.email, time, files: next };
      await writeLog(folder, { ...log, [branch]: [entry, ...(amended ? older : (log[branch] ?? []))] });
      return { id: shortId(id), summary };
    },

    async discard(path, { paths, lines = {} }) {
      const folder = await repository(path);
      if (paths.length === 0) throw new Error('Choose at least one file to discard');
      const [refs, branch, files] = await Promise.all([readRefs(folder), currentBranch(folder), readFiles(folder)]);
      const head = refs[branch] ?? {};
      const stale = paths.filter((file) => {
        const picked = lines[file];
        if (!picked || picked.lines.length === 0) return false;
        return picked.version !== `${hashOf(head[file] ?? '')}:${hashOf(files.get(file) ?? '')}`;
      });
      if (stale.length > 0) {
        throw new GitError('STALE', `${stale[0]} changed since you picked its lines: check them again`, stale);
      }
      const first = basename(paths[0]);
      await engine.snapshot(
        folder,
        `Before discarding changes to ${paths.length === 1 ? first : `${first} and ${paths.length - 1} more`}`,
      );
      for (const file of paths) {
        const picked = lines[file];
        // Discarding some lines: the file with every other change kept (all of them picked: the whole file)
        const kept =
          picked && picked.lines.length > 0
            ? applyExclusion(head[file] ?? '', files.get(file) ?? '', new Set(picked.lines))
            : null;
        if (kept !== null) await writeFile(folder, file, kept);
        else if (file in head) await writeFile(folder, file, head[file]);
        else if (files.has(file)) await space.delete(joinPath(folder, file));
      }
    },

    async stash(path) {
      const folder = await repository(path);
      const [stashes, branch] = await Promise.all([readStashes(folder), currentBranch(folder)]);
      const found = stashes[branch];
      return found ? { branch, time: found.time, files: found.changes } : null;
    },

    async stashChanges(path) {
      const folder = await repository(path);
      const [refs, branch, changes] = await Promise.all([readRefs(folder), currentBranch(folder), engine.status(path)]);
      if (!(branch in refs)) throw new Error('Make the first commit before stashing');
      if (changes.length === 0) throw new Error('No changes to stash');
      await engine.snapshot(folder, `Before stashing changes on ${branch}`);
      const files = await readFiles(folder);
      const head = refs[branch];
      const stashed: StashedFiles = { time: Date.now(), changes, files: {}, base: {} };
      for (const { path: file } of changes) {
        stashed.files[file] = files.get(file) ?? null;
        stashed.base[file] = head[file] ?? null;
        // The branch as its last commit
        if (file in head) await writeFile(folder, file, head[file]);
        else await space.delete(joinPath(folder, file));
      }
      const stashes = await readStashes(folder);
      await writeStashes(folder, { ...stashes, [branch]: stashed });
      return { branch, time: stashed.time, files: changes };
    },

    async restoreStash(path) {
      const folder = await repository(path);
      const [refs, branch, stashes, changes] = await Promise.all([
        readRefs(folder),
        currentBranch(folder),
        readStashes(folder),
        engine.status(path),
      ]);
      const stashed = stashes[branch];
      if (!stashed) throw new Error(`No stashed changes on ${branch}`);
      if (changes.length > 0) {
        const paths = changes.map((change) => change.path);
        throw new GitError(
          'CONFLICT',
          `Commit your changes to ${basename(paths[0])} before restoring the stash`,
          paths,
        );
      }
      const head = refs[branch] ?? {};
      // A file committed since, differently: the stash no longer fits
      if (Object.entries(stashed.base).some(([file, text]) => (head[file] ?? null) !== text)) {
        throw new Error(
          `The stashed changes conflict with commits made on ${branch} since: nothing was changed, the stash is kept`,
        );
      }
      for (const [file, text] of Object.entries(stashed.files)) {
        if (text === null) await space.delete(joinPath(folder, file));
        else await writeFile(folder, file, text);
      }
      const rest = { ...stashes };
      delete rest[branch];
      await writeStashes(folder, rest);
    },

    async dropStash(path) {
      const folder = await repository(path);
      const [branch, stashes] = await Promise.all([currentBranch(folder), readStashes(folder)]);
      if (!stashes[branch]) throw new Error(`No stashed changes on ${branch}`);
      const rest = { ...stashes };
      delete rest[branch];
      await writeStashes(folder, rest);
    },

    async lastCommit(path) {
      const folder = await repository(path);
      const [log, branch] = await Promise.all([readLog(folder), currentBranch(folder)]);
      const last = log[branch]?.[0];
      if (!last) return null;
      const { files: _files, ...commit } = last;
      return { commit, onGitHub: onGitHub(log, last.id), merge: false };
    },

    async revert(path, commit) {
      const folder = await repository(path);
      const { files: after, parent: before } = await findCommit(folder, commit);
      const [refs, branch, log, changes] = await Promise.all([
        readRefs(folder),
        currentBranch(folder),
        readLog(folder),
        engine.status(path),
      ]);
      const entry = Object.values(log)
        .flat()
        .find((candidate) => candidate.id.startsWith(commit));
      const summary = entry?.summary ?? commit;
      const head = refs[branch] ?? {};
      const touched = [...new Set([...Object.keys(after), ...Object.keys(before)])]
        .filter((file) => after[file] !== before[file])
        .sort();
      // The stand-in compares whole files: one changed again since clashes
      const clashes = touched.filter((file) => head[file] !== after[file] && head[file] !== before[file]);
      if (clashes.length > 0) {
        throw new GitError(
          'MERGE_CONFLICT',
          `Commits made after "${summary}" changed the same lines in ${basename(clashes[0])}`,
          clashes,
        );
      }
      const reverting = touched.filter((file) => head[file] === after[file]);
      if (reverting.length === 0) throw new Error('Its changes are not on the branch any more: nothing to revert');
      const inTheWay = changes.map((change) => change.path).filter((file) => reverting.includes(file));
      if (inTheWay.length > 0) {
        throw new GitError('CONFLICT', `Commit your changes to ${basename(inTheWay[0])} before reverting`, inTheWay);
      }
      await engine.snapshot(folder, `Before reverting ${shortId(entry?.id ?? commit)}`);
      for (const file of reverting) {
        if (before[file] === undefined) await space.delete(joinPath(folder, file));
        else await writeFile(folder, file, before[file]);
      }
      return engine.commit(path, {
        message: `Revert "${summary}"\n\nThis reverts commit ${entry?.id ?? commit}.`,
        paths: reverting,
      });
    },

    async undoCommit(path) {
      const folder = await repository(path);
      const [refs, log, branch] = await Promise.all([readRefs(folder), readLog(folder), currentBranch(folder)]);
      const [last, ...rest] = log[branch] ?? [];
      if (!last) throw new Error('There is no commit to undo');
      if (onGitHub(log, last.id)) {
        throw new GitError('PUSHED', `"${last.summary}" is on GitHub already: undoing it there needs a force push`);
      }
      // The files stay as they are: only the branch goes back
      const nextRefs = { ...refs };
      if (rest.length > 0) nextRefs[branch] = rest[0].files;
      else delete nextRefs[branch];
      await writeRefs(folder, nextRefs);
      await writeLog(folder, { ...log, [branch]: rest });
      const { files: _files, ...commit } = last;
      return commit;
    },

    async log(path, { skip = 0, limit = LOG_PAGE } = {}) {
      const folder = await repository(path);
      const [log, branch] = await Promise.all([readLog(folder), currentBranch(folder)]);
      return (log[branch] ?? []).slice(skip, skip + limit).map(({ files: _files, ...entry }) => entry);
    },

    async commitChanges(path, commit) {
      const { files, parent } = await findCommit(await repository(path), commit);
      const changes: FileChange[] = [];
      for (const [file, text] of Object.entries(files)) {
        if (!(file in parent)) changes.push({ path: file, kind: 'new' });
        else if (parent[file] !== text) changes.push({ path: file, kind: 'modified' });
      }
      for (const file of Object.keys(parent)) if (!(file in files)) changes.push({ path: file, kind: 'deleted' });
      return changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    },

    async commitDiff(path, commit, file) {
      const { files, parent } = await findCommit(await repository(path), commit);
      const before = parent[file] ?? '';
      const after = files[file] ?? '';
      if (before.length > DIFF_MAX_CHARS || after.length > DIFF_MAX_CHARS) {
        return { version: '', binary: false, tooLarge: true, hunks: [] };
      }
      return { version: '', binary: false, tooLarge: false, hunks: diffTexts(before, after) };
    },

    async snapshot(path, reason) {
      const folder = await repository(path);
      const [snapshots, files] = await Promise.all([readSnapshots(folder), readFiles(folder)]);
      const tree = Object.fromEntries(files);
      const last = snapshots[0];
      if (last && JSON.stringify(last.files) === JSON.stringify(tree)) return last.id;
      const time = Date.now();
      const id = [0, 1, 2, 3, 4]
        .map((part) => hashOf(`snapshot:${part}:${folder}:${snapshots.length}:${time}`).padStart(8, '0'))
        .join('');
      const next = [{ id, reason: reason.trim() || 'Snapshot', time, files: tree }, ...snapshots];
      await space.writeTextFile(gitPath(folder, 'pepino-snapshots.json'), JSON.stringify(next));
      return id;
    },

    async snapshotVersions(path, file) {
      const versions: SnapshotVersion[] = [];
      let newer: string | undefined;
      for (const { files, ...version } of await readSnapshots(await repository(path))) {
        const text = files[file];
        if (text !== undefined && text !== newer) versions.push(version);
        newer = text;
      }
      return versions;
    },

    async snapshotFile(path, id, file) {
      const snapshot = (await readSnapshots(await repository(path))).find((candidate) => candidate.id === id);
      if (!snapshot) throw new Error(`No snapshot ${id}`);
      return snapshot.files[file] ?? null;
    },

    identity: async () => identity,

    async setIdentity(next) {
      const name = next.name.trim();
      const email = next.email.trim();
      if (!name || !email) throw new Error('A name and an email are needed');
      identity = { name, email };
    },

    async branches(path) {
      const folder = await repository(path);
      const [refs, current, remotes] = await Promise.all([
        readRefs(folder),
        currentBranch(folder),
        readRemotes(folder),
      ]);
      const names = [...new Set([...Object.keys(refs), current])].sort();
      const local: Branch[] = names.map((name) => ({ name, current: name === current }));
      const remote: Branch[] = Object.keys(remotes)
        .filter((name) => !names.includes(name))
        .sort()
        .map((name) => ({ name, current: false, remote: true }));
      return [...local, ...remote];
    },

    async createBranch(path, rawName) {
      const folder = await repository(path);
      const name = rawName.trim();
      if (!isValidBranchName(name)) throw new Error(`Not a valid branch name: ${name}`);
      const [refs, current] = await Promise.all([readRefs(folder), currentBranch(folder)]);
      if (!(current in refs)) throw new Error('Make the first commit before creating branches');
      if (name in refs) throw new Error(`There is already a branch named ${name}`);
      await writeRefs(folder, { ...refs, [name]: refs[current] });
      const log = await readLog(folder);
      await writeLog(folder, { ...log, [name]: log[current] ?? [] });
      await setCurrentBranch(folder, name);
      return { branch: name, hasCommits: true };
    },

    async checkout(path, name) {
      const folder = await repository(path);
      const [refs, current, files, remotes] = await Promise.all([
        readRefs(folder),
        currentBranch(folder),
        readFiles(folder),
        readRemotes(folder),
      ]);
      if (name === current) return { branch: name, hasCommits: name in refs };
      const target = refs[name] ?? remotes[name];
      if (!target) throw new Error(`No branch named ${name}`);
      const source = refs[current] ?? {};
      const differing = [...new Set([...Object.keys(source), ...Object.keys(target)])].filter(
        (file) => source[file] !== target[file],
      );
      // Like git: uncommitted changes to a file the branches disagree on would be lost.
      const conflicts = differing.filter((file) => files.get(file) !== source[file]).sort();
      if (conflicts.length > 0) {
        throw new GitError('CONFLICT', `Commit your changes to ${conflicts[0]} before switching branch`, conflicts);
      }
      // The files are about to be rewritten: keep how they are first.
      await engine.snapshot(folder, `Before switching to ${name}`);
      for (const file of differing) {
        if (file in target) await writeFile(folder, file, target[file]);
        else await space.delete(joinPath(folder, file));
      }
      if (!(name in refs)) {
        // GitHub's branch gets its local one, with origin's history
        await writeRefs(folder, { ...refs, [name]: target });
        const log = await readLog(folder);
        await writeLog(folder, { ...log, [name]: log[`origin/${name}`] ?? [] });
      }
      await setCurrentBranch(folder, name);
      return { branch: name, hasCommits: true };
    },

    async deleteBranch(path, name, { force = false } = {}) {
      const folder = await repository(path);
      const [refs, current] = await Promise.all([readRefs(folder), currentBranch(folder)]);
      if (name === current) throw new Error(`Switch to another branch before deleting ${name}`);
      if (!(name in refs)) throw new Error(`No branch named ${name}`);
      const snapshot = JSON.stringify(refs[name]);
      const elsewhere = Object.entries(refs).some(
        ([other, files]) => other !== name && JSON.stringify(files) === snapshot,
      );
      if (!elsewhere && !force) throw new GitError('NOT_MERGED', `${name} has commits that are on no other branch`);
      const rest = { ...refs };
      delete rest[name];
      await writeRefs(folder, rest);
      const log = await readLog(folder);
      delete log[name];
      await writeLog(folder, log);
    },

    async clone(path, url, onProgress) {
      const folder = project(path);
      const existing = await space.listDirectory(folder).catch(() => null);
      if (existing && existing.length > 0) throw new Error(`Already exists and is not empty: ${basename(folder)}`);
      // The steps JGit goes through, at a pace to watch; cancelling writes nothing
      remoteCancelled = false;
      for (const task of ['Receiving objects', 'Resolving deltas', 'Checking out files']) {
        for (let done = 0; done <= 100; done += 20) {
          if (remoteCancelled) throw new GitError('CANCELLED', 'Clone cancelled');
          onProgress?.({ task, done, total: 100 });
          await new Promise((resolve) => setTimeout(resolve, cloneStepMs));
        }
      }
      const name = basename(url).replace(/\.git$/, '');
      const owner = basename(parentPath(new URL(url).pathname));
      const files: Snapshot = {
        'README.md': `# ${name}\n\nCloned from ${url}\n`,
        'src/index.ts': `export const hello = '${name}';\n`,
      };
      if (!existing) await space.createDirectory(folder);
      for (const [file, text] of Object.entries(files)) await writeFile(folder, file, text);
      await engine.init(folder);
      await writeRefs(folder, { [DEFAULT_BRANCH]: files });
      const time = Date.now();
      const id = hashOf(`${url}:${time}`).padStart(8, '0').repeat(5);
      const entry = { id, summary: 'Initial commit', description: '', author: owner, email: '', time, files };
      // and a branch only on GitHub, to switch to
      const develop: Snapshot = { ...files, 'CHANGELOG.md': '# Changelog\n\n- Work in progress\n' };
      await writeRemotes(folder, { [DEFAULT_BRANCH]: files, develop });
      await space.writeTextFile(gitPath(folder, 'pepino-origin'), url);
      await space.writeTextFile(gitPath(folder, 'pepino-last-fetch'), String(Date.now()));
      const ahead = {
        ...entry,
        id: hashOf(`${url}:develop`).padStart(8, '0').repeat(5),
        summary: 'Start the changelog',
      };
      await writeLog(folder, {
        [DEFAULT_BRANCH]: [entry],
        [`origin/${DEFAULT_BRANCH}`]: [entry],
        'origin/develop': [{ ...ahead, time: time + 1, files: develop }, entry],
      });
      return { branch: DEFAULT_BRANCH, hasCommits: true };
    },

    async cancelRemote() {
      remoteCancelled = true;
    },

    async sync(path) {
      return syncOf(await repository(path));
    },

    async originUrl(path) {
      const folder = await repository(path);
      return space.readTextFile(gitPath(folder, 'pepino-origin')).catch(() => null);
    },

    async syncCommits(path) {
      const folder = await repository(path);
      const state = await syncOf(folder);
      if (!state.upstream) return { toPull: [], toPush: [] };
      const [branch, log] = await Promise.all([currentBranch(folder), readLog(folder)]);
      const local = log[branch] ?? [];
      const there = log[state.upstream] ?? [];
      const only = (side: typeof local, other: typeof local) => {
        const ids = new Set(other.map((entry) => entry.id));
        return side
          .filter((entry) => !ids.has(entry.id))
          .slice(0, SYNC_COMMITS)
          .map(({ files: _files, ...entry }) => entry);
      };
      return { toPull: only(there, local), toPush: only(local, there) };
    },

    async fetch(path, onProgress) {
      const folder = await repository(path);
      await fetchInto(folder, onProgress);
      return syncOf(folder);
    },

    async pull(path, onProgress) {
      const folder = await repository(path);
      await fetchInto(folder, onProgress);
      const state = await syncOf(folder);
      if (!state.upstream) throw new Error('This branch is not on GitHub yet: publish it first');
      if (state.behind === 0) return state;
      const branch = await currentBranch(folder);
      const [refs, remotes, log, files] = await Promise.all([
        readRefs(folder),
        readRemotes(folder),
        readLog(folder),
        readFiles(folder),
      ]);
      const ours = refs[branch] ?? {};
      const theirs = remotes[branch];
      const remoteLog = log[`origin/${branch}`] ?? [];
      const localIds = new Set((log[branch] ?? []).map((entry) => entry.id));
      // The last commit both have: what each side changed since
      const base = remoteLog.find((entry) => localIds.has(entry.id))?.files ?? {};
      const changed = (side: Snapshot) =>
        [...new Set([...Object.keys(side), ...Object.keys(base)])].filter((file) => side[file] !== base[file]);
      const mine = changed(ours);
      const clash = changed(theirs)
        .filter((file) => mine.includes(file) && ours[file] !== theirs[file])
        .sort();
      if (clash.length > 0) {
        throw new GitError('MERGE_CONFLICT', `GitHub's changes and yours touch the same lines in ${clash[0]}`, clash);
      }
      if (state.ahead > 0 && !identity) {
        throw new Error('Set your name and email for commits first: this pull makes a merge commit');
      }
      const next: Snapshot = { ...theirs };
      for (const file of mine) {
        if (file in ours) next[file] = ours[file];
        else delete next[file];
      }
      const differing = [...new Set([...Object.keys(ours), ...Object.keys(next)])].filter(
        (file) => ours[file] !== next[file],
      );
      const inTheWay = differing.filter((file) => files.get(file) !== ours[file]).sort();
      if (inTheWay.length > 0) {
        throw new GitError('CONFLICT', `Commit your changes to ${inTheWay[0]} before pulling`, inTheWay);
      }
      await engine.snapshot(folder, `Before pulling ${state.upstream}`);
      for (const file of differing) {
        if (file in next) await writeFile(folder, file, next[file]);
        else await space.delete(joinPath(folder, file));
      }
      await writeRefs(folder, { ...refs, [branch]: next });
      const theirsOnly = remoteLog.filter((entry) => !localIds.has(entry.id));
      const time = Date.now();
      const entries =
        state.ahead === 0
          ? remoteLog
          : [
              {
                id: hashOf(`merge:${folder}:${time}`).padStart(8, '0').repeat(5),
                summary: `Merge ${state.upstream} into ${branch}`,
                description: '',
                author: identity!.name,
                email: identity!.email,
                time,
                files: next,
              },
              ...(log[branch] ?? []),
              ...theirsOnly,
            ];
      await writeLog(folder, { ...log, [branch]: entries });
      return syncOf(folder);
    },

    async push(path, onProgress) {
      const folder = await repository(path);
      // As GitHub does: what it has now decides, not the last fetch
      await fetchInto(folder, onProgress);
      const state = await syncOf(folder);
      if (state.behind > 0) {
        throw new GitError('REJECTED', 'GitHub has commits this branch does not: pull first, then push');
      }
      await remoteSteps(['Counting objects', 'Writing objects'], onProgress);
      const branch = await currentBranch(folder);
      const [refs, remotes, log] = await Promise.all([readRefs(folder), readRemotes(folder), readLog(folder)]);
      if (!(branch in refs)) throw new Error('Make the first commit before pushing');
      await writeRemotes(folder, { ...remotes, [branch]: refs[branch] });
      await writeLog(folder, { ...log, [`origin/${branch}`]: log[branch] ?? [] });
      return syncOf(folder);
    },
  };

  /** The stand-in's GitHub: a clone's branches there ([readRemotes]) and their history as `origin/…` in the log. */
  async function syncOf(folder: string): Promise<SyncState> {
    const remote = await space
      .readTextFile(gitPath(folder, 'pepino-remotes.json'))
      .then(() => true)
      .catch(() => false);
    const [branch, remotes, log, fetched] = await Promise.all([
      currentBranch(folder),
      readRemotes(folder),
      readLog(folder),
      space.readTextFile(gitPath(folder, 'pepino-last-fetch')).catch(() => null),
    ]);
    const lastFetched = fetched === null ? null : Number(fetched);
    if (!remote || !(branch in remotes)) return { remote, upstream: null, ahead: 0, behind: 0, lastFetched };
    const local = (log[branch] ?? []).map((entry) => entry.id);
    const there = (log[`origin/${branch}`] ?? []).map((entry) => entry.id);
    return {
      remote,
      upstream: `origin/${branch}`,
      ahead: local.filter((id) => !there.includes(id)).length,
      behind: there.filter((id) => !local.includes(id)).length,
      lastFetched,
    };
  }

  /** Steps at a pace to watch; cancelling stops before anything is written. */
  async function remoteSteps(tasks: string[], onProgress?: (progress: RemoteProgress) => void) {
    remoteCancelled = false;
    for (const task of tasks) {
      for (let done = 0; done <= 100; done += 25) {
        if (remoteCancelled) throw new GitError('CANCELLED', 'Cancelled');
        onProgress?.({ task, done, total: 100 });
        await new Promise((resolve) => setTimeout(resolve, cloneStepMs));
      }
    }
  }

  /** The first fetch of a branch finds a teammate's commit on GitHub, to try Pull with. */
  async function fetchInto(folder: string, onProgress?: (progress: RemoteProgress) => void) {
    const state = await syncOf(folder);
    if (!state.remote) throw new Error('This repository is not connected to GitHub');
    await remoteSteps(['Receiving objects'], onProgress);
    await space.writeTextFile(gitPath(folder, 'pepino-last-fetch'), String(Date.now()));
    const branch = await currentBranch(folder);
    const marker = gitPath(folder, `pepino-fetched-${branch.replaceAll('/', '_')}`);
    if (
      !state.upstream ||
      (await space
        .readTextFile(marker)
        .then(() => true)
        .catch(() => false))
    )
      return;
    const [remotes, log] = await Promise.all([readRemotes(folder), readLog(folder)]);
    const files = { ...remotes[branch], 'NOTES.md': '# Notes\n\nAdded on GitHub by a teammate.\n' };
    const time = Date.now();
    const entry = {
      id: hashOf(`teammate:${folder}:${branch}`).padStart(8, '0').repeat(5),
      summary: 'Add notes',
      description: '',
      author: 'teammate',
      email: '',
      time,
      files,
    };
    await writeRemotes(folder, { ...remotes, [branch]: files });
    await writeLog(folder, { ...log, [`origin/${branch}`]: [entry, ...(log[`origin/${branch}`] ?? [])] });
    await space.writeTextFile(marker, String(time));
  }
  return engine;
}
