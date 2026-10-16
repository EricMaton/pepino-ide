import { registerPlugin } from '@capacitor/core';
import { ProjectSpaceError } from '../projects/errors';
import { isWithin, joinPath, parentPath, resolveInRoot } from '../projects/paths';
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

export interface Branch {
  name: string;
  /** The branch HEAD is on. */
  current: boolean;
}

/**
 * A git failure the UI handles: switching branch would overwrite uncommitted
 * changes to [paths], a branch to delete has commits on no other branch, or
 * [paths] changed after their lines were picked for a commit.
 */
export class GitError extends Error {
  constructor(
    readonly code: 'CONFLICT' | 'NOT_MERGED' | 'STALE',
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
  /** The identity commits are made with, or null until it is set. */
  identity(): Promise<Identity | null>;
  setIdentity(identity: Identity): Promise<void>;
  /** The local branches by name (with no commits yet, just the unborn current one). */
  branches(path: string): Promise<Branch[]>;
  /** Creates [name] at the current commit and switches to it; uncommitted changes come along. */
  createBranch(path: string, name: string): Promise<RepoInfo>;
  /**
   * Switches to [name], rewriting the files that differ (announced as fs.*
   * events). Rejects with a CONFLICT [GitError] when uncommitted changes would
   * be overwritten; nothing changes then.
   */
  checkout(path: string, name: string): Promise<RepoInfo>;
  /** Deletes [name] (never the current branch); NOT_MERGED unless [force] when its commits are on no other branch. */
  deleteBranch(path: string, name: string, options?: { force?: boolean }): Promise<void>;
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
  identity(): Promise<{ identity: Identity | null }>;
  setIdentity(options: Identity): Promise<void>;
  branches(options: { path: string }): Promise<{ branches: Branch[] }>;
  createBranch(options: { path: string; name: string }): Promise<RepoInfo>;
  checkout(options: { path: string; name: string }): Promise<{ info: RepoInfo; written: string[]; removed: string[] }>;
  deleteBranch(options: { path: string; name: string; force: boolean }): Promise<void>;
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
  if (code === 'CONFLICT' || code === 'NOT_MERGED' || code === 'STALE') {
    return new GitError(code, message ?? code, data?.paths ?? []);
  }
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
export function createMemoryGitEngine(space: ProjectSpace): GitEngine {
  let identity: Identity | null = null;
  let commits = 0;
  const gitPath = (folder: string, name: string) => joinPath(joinPath(folder, GIT_DIR), name);

  const readRefs = async (folder: string): Promise<Record<string, Snapshot>> => {
    const raw = await space.readTextFile(gitPath(folder, 'pepino-refs.json')).catch(() => '{}');
    return JSON.parse(raw) as Record<string, Snapshot>;
  };
  const writeRefs = (folder: string, refs: Record<string, Snapshot>) =>
    space.writeTextFile(gitPath(folder, 'pepino-refs.json'), JSON.stringify(refs));

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
      return { id: (0x1000000 + commits * 7919).toString(16).slice(-7), summary };
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
      const [refs, current] = await Promise.all([readRefs(folder), currentBranch(folder)]);
      const names = [...new Set([...Object.keys(refs), current])].sort();
      return names.map((name) => ({ name, current: name === current }));
    },

    async createBranch(path, rawName) {
      const folder = await repository(path);
      const name = rawName.trim();
      if (!isValidBranchName(name)) throw new Error(`Not a valid branch name: ${name}`);
      const [refs, current] = await Promise.all([readRefs(folder), currentBranch(folder)]);
      if (!(current in refs)) throw new Error('Make the first commit before creating branches');
      if (name in refs) throw new Error(`There is already a branch named ${name}`);
      await writeRefs(folder, { ...refs, [name]: refs[current] });
      await setCurrentBranch(folder, name);
      return { branch: name, hasCommits: true };
    },

    async checkout(path, name) {
      const folder = await repository(path);
      const [refs, current, files] = await Promise.all([readRefs(folder), currentBranch(folder), readFiles(folder)]);
      if (name === current) return { branch: name, hasCommits: name in refs };
      const target = refs[name];
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
      for (const file of differing) {
        if (file in target) await writeFile(folder, file, target[file]);
        else await space.delete(joinPath(folder, file));
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
    },
  };
  return engine;
}
