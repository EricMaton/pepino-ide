import { registerPlugin } from '@capacitor/core';
import { ProjectSpaceError } from '../projects/errors';
import { joinPath, resolveInRoot } from '../projects/paths';
import { canBeProject, GIT_DIR, isRepository, MARKER_DIR } from '../projects/projects';
import type { ProjectSpace } from '../projects/projectSpace';

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

export interface GitEngine {
  isRepository(path: string): Promise<boolean>;
  /** Makes the folder at [path] a repository on [DEFAULT_BRANCH]; an existing one is left as it is. */
  init(path: string): Promise<RepoInfo>;
  /** The repository at [path], or null when it is not one. */
  info(path: string): Promise<RepoInfo | null>;
  /** Every file that differs from the last commit, sorted by path. */
  status(path: string): Promise<FileChange[]>;
  /**
   * Commits exactly [paths] as they are on disk (a missing one is a deletion),
   * like GitHub Desktop's ticked files: whatever was staged before is left out.
   */
  commit(path: string, commit: { message: string; paths: readonly string[] }): Promise<CommitResult>;
  /** The identity commits are made with, or null until it is set. */
  identity(): Promise<Identity | null>;
  setIdentity(identity: Identity): Promise<void>;
}

interface GitPlugin {
  isRepository(options: { path: string }): Promise<{ repository: boolean }>;
  init(options: { path: string }): Promise<RepoInfo>;
  info(options: { path: string }): Promise<{ info: RepoInfo | null }>;
  status(options: { path: string }): Promise<{ changes: FileChange[] }>;
  commit(options: { path: string; message: string; paths: string[] }): Promise<CommitResult>;
  identity(): Promise<{ identity: Identity | null }>;
  setIdentity(options: Identity): Promise<void>;
}

const project = (path: string): string => {
  if (!canBeProject(path)) throw new ProjectSpaceError('InvalidName', 'The project space is not a project');
  return resolveInRoot(path);
};

/** The first line of a commit message. */
export const summaryOf = (message: string): string => message.trim().split('\n')[0].trim();

/**
 * JGit through the native plugin. It writes `.git` straight to disk, past the
 * project space, so [onCreated] announces it (an `fs.created`) for the
 * explorer and the GIT screen to follow.
 */
export function createNativeGitEngine(onCreated: (path: string) => void): GitEngine {
  const git = registerPlugin<GitPlugin>('Git');
  return {
    async isRepository(path) {
      return (await git.isRepository({ path: project(path) })).repository;
    },
    async init(path) {
      const folder = project(path);
      const existed = (await git.isRepository({ path: folder })).repository;
      const info = await git.init({ path: folder });
      if (!existed) onCreated(joinPath(folder, GIT_DIR));
      return info;
    },
    async info(path) {
      return (await git.info({ path: project(path) })).info;
    },
    async status(path) {
      return (await git.status({ path: project(path) })).changes;
    },
    commit(path, { message, paths }) {
      return git.commit({ path: project(path), message, paths: [...paths] });
    },
    async identity() {
      return (await git.identity()).identity;
    },
    setIdentity(identity) {
      return git.setIdentity(identity);
    },
  };
}

/** Folders the stand-in never looks into: git's and Pepino's own, and dependencies. */
const SKIPPED = new Set([GIT_DIR, MARKER_DIR, 'node_modules']);

/**
 * A stand-in for the web and tests: a repository is a `.git` folder whose
 * HEAD names the branch, and the last commit is a copy of the committed files
 * kept in `.git/pepino-head.json`. Enough to try the GIT screens with
 * `npm run dev`; the real thing is JGit, tested in JUnit (ADR-006).
 */
export function createMemoryGitEngine(space: ProjectSpace): GitEngine {
  let identity: Identity | null = null;
  let commits = 0;
  const gitPath = (folder: string, name: string) => joinPath(joinPath(folder, GIT_DIR), name);

  const readHead = async (folder: string): Promise<Record<string, string>> => {
    const raw = await space.readTextFile(gitPath(folder, 'pepino-head.json')).catch(() => '{}');
    return JSON.parse(raw) as Record<string, string>;
  };

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

  const engine: GitEngine = {
    isRepository: async (path) => isRepository(space, project(path)),

    async init(path) {
      const folder = project(path);
      if (!(await isRepository(space, folder))) {
        await space.createDirectory(joinPath(folder, GIT_DIR));
        await space.writeTextFile(gitPath(folder, 'HEAD'), `ref: refs/heads/${DEFAULT_BRANCH}\n`);
      }
      return (await engine.info(folder))!;
    },

    async info(path) {
      const folder = project(path);
      if (!(await isRepository(space, folder))) return null;
      const head = (await space.readTextFile(gitPath(folder, 'HEAD')).catch(() => '')).trim();
      const ref = 'ref: refs/heads/';
      const committed = await space.readTextFile(gitPath(folder, 'pepino-head.json')).then(
        () => true,
        () => false,
      );
      return { branch: head.startsWith(ref) ? head.slice(ref.length) : 'HEAD', hasCommits: committed };
    },

    async status(path) {
      const folder = await repository(path);
      const [head, files] = await Promise.all([readHead(folder), readFiles(folder)]);
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

    async commit(path, { message, paths }) {
      const folder = await repository(path);
      if (!identity) throw new Error('Set your name and email for commits first');
      if (paths.length === 0) throw new Error('Choose at least one file to commit');
      const summary = summaryOf(message);
      if (!summary) throw new Error('A commit needs a summary');
      const [head, files] = await Promise.all([readHead(folder), readFiles(folder)]);
      const next = { ...head };
      for (const file of paths) {
        const text = files.get(file);
        if (text === undefined) delete next[file];
        else next[file] = text;
      }
      if (JSON.stringify(next) === JSON.stringify(head) && (await engine.info(folder))?.hasCommits) {
        throw new Error('Those files have no changes to commit');
      }
      await space.writeTextFile(gitPath(folder, 'pepino-head.json'), JSON.stringify(next));
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
  };
  return engine;
}
