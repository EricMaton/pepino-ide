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
 * commit (STALE); or talking to GitHub (#32): the user stopped it
 * (CANCELLED), GitHub refused the sign-in (UNAUTHORIZED), no connection
 * (NETWORK).
 */
export type GitErrorCode = 'CONFLICT' | 'NOT_MERGED' | 'STALE' | 'CANCELLED' | 'UNAUTHORIZED' | 'NETWORK';

const GIT_ERROR_CODES: readonly GitErrorCode[] = [
  'CONFLICT',
  'NOT_MERGED',
  'STALE',
  'CANCELLED',
  'UNAUTHORIZED',
  'NETWORK',
];

/** How a clone goes: the step git is on ("Receiving objects"…), and how far; [total] is 0 when unknown. */
export interface CloneProgress {
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
   */
  commit(
    path: string,
    commit: { message: string; paths: readonly string[]; excluded?: Readonly<Record<string, LineExclusion>> },
  ): Promise<CommitResult>;
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
   * nothing behind; [cancelClone] makes it reject with CANCELLED.
   */
  clone(path: string, url: string, onProgress?: (progress: CloneProgress) => void): Promise<RepoInfo>;
  cancelClone(): Promise<void>;
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
  }): Promise<CommitResult>;
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
  cancelClone(): Promise<void>;
  addListener(event: 'cloneProgress', listener: (progress: CloneProgress) => void): Promise<PluginListenerHandle>;
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
    commit(path, { message, paths, excluded = {} }) {
      return git
        .commit({ path: project(path), message, paths: [...paths], excluded: { ...excluded } })
        .catch((error: unknown) => {
          throw gitError(error);
        });
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
      const listening = onProgress ? await git.addListener('cloneProgress', onProgress) : null;
      try {
        const info = await git.clone({ path: folder, url }).catch((error: unknown) => {
          throw gitError(error);
        });
        announce('fs.created', { path: folder });
        return info;
      } finally {
        await listening?.remove();
      }
    },
    cancelClone() {
      return git.cancelClone();
    },
  };
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
  let cloneCancelled = false;
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

  /** Each branch's commits, newest first, with the files as each one left them. */
  type Log = Record<string, (LogEntry & { files: Snapshot })[]>;
  const readLog = async (folder: string): Promise<Log> => {
    const raw = await space.readTextFile(gitPath(folder, 'pepino-log.json')).catch(() => '{}');
    return JSON.parse(raw) as Log;
  };
  const writeLog = (folder: string, log: Log) =>
    space.writeTextFile(gitPath(folder, 'pepino-log.json'), JSON.stringify(log));

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

    async commit(path, { message, paths, excluded = {} }) {
      const folder = await repository(path);
      if (!identity) throw new Error('Set your name and email for commits first');
      if (paths.length === 0) throw new Error('Choose at least one file to commit');
      const summary = summaryOf(message);
      if (!summary) throw new Error('A commit needs a summary');
      const [refs, branch, files] = await Promise.all([readRefs(folder), currentBranch(folder), readFiles(folder)]);
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
      if (branch in refs && JSON.stringify(next) === JSON.stringify(head)) {
        throw new Error('Those files have no changes to commit');
      }
      await writeRefs(folder, { ...refs, [branch]: next });
      commits += 1;
      const time = Date.now();
      const id = [0, 1, 2, 3, 4]
        .map((part) => hashOf(`${part}:${folder}:${branch}:${commits}:${time}:${message}`).padStart(8, '0'))
        .join('');
      const log = await readLog(folder);
      const description = message.trim().split('\n').slice(1).join('\n').trim();
      const entry = { id, summary, description, author: identity.name, email: identity.email, time, files: next };
      await writeLog(folder, { ...log, [branch]: [entry, ...(log[branch] ?? [])] });
      return { id: shortId(id), summary };
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
      cloneCancelled = false;
      for (const task of ['Receiving objects', 'Resolving deltas', 'Checking out files']) {
        for (let done = 0; done <= 100; done += 20) {
          if (cloneCancelled) throw new GitError('CANCELLED', 'Clone cancelled');
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
      await space.writeTextFile(gitPath(folder, 'pepino-remotes.json'), JSON.stringify({ develop }));
      const ahead = {
        ...entry,
        id: hashOf(`${url}:develop`).padStart(8, '0').repeat(5),
        summary: 'Start the changelog',
      };
      await writeLog(folder, {
        [DEFAULT_BRANCH]: [entry],
        'origin/develop': [{ ...ahead, time: time + 1, files: develop }, entry],
      });
      return { branch: DEFAULT_BRANCH, hasCommits: true };
    },

    async cancelClone() {
      cloneCancelled = true;
    },
  };
  return engine;
}
