import { registerPlugin } from '@capacitor/core';
import { ProjectSpaceError } from '../projects/errors';
import { joinPath, resolveInRoot } from '../projects/paths';
import { canBeProject, GIT_DIR, isRepository } from '../projects/projects';
import type { ProjectSpace } from '../projects/projectSpace';

/*
 * The git engine (ADR-006): what the UI asks git for, without knowing what
 * runs underneath. On Android it is JGit in the native `Git` plugin; on the
 * web (`npm run dev`) and in tests a small stand-in on the project space.
 * Paths are project folders, relative to the space root like everywhere else.
 */
export const DEFAULT_BRANCH = 'main';

export interface RepoInfo {
  /** The current branch (HEAD's), e.g. "main". */
  branch: string;
  /** False until the first commit. */
  hasCommits: boolean;
}

export interface GitEngine {
  isRepository(path: string): Promise<boolean>;
  /** Makes the folder at [path] a repository on [DEFAULT_BRANCH]; an existing one is left as it is. */
  init(path: string): Promise<RepoInfo>;
  /** The repository at [path], or null when it is not one. */
  info(path: string): Promise<RepoInfo | null>;
}

interface GitPlugin {
  isRepository(options: { path: string }): Promise<{ repository: boolean }>;
  init(options: { path: string }): Promise<RepoInfo>;
  info(options: { path: string }): Promise<{ info: RepoInfo | null }>;
}

const project = (path: string): string => {
  if (!canBeProject(path)) throw new ProjectSpaceError('InvalidName', 'The project space is not a project');
  return resolveInRoot(path);
};

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
  };
}

/**
 * A stand-in for the web and tests: a repository is a `.git` folder whose
 * HEAD names the branch. There are no commits yet; they come with #23.
 */
export function createMemoryGitEngine(space: ProjectSpace): GitEngine {
  const headOf = (folder: string) => joinPath(joinPath(folder, GIT_DIR), 'HEAD');
  const engine: GitEngine = {
    isRepository: async (path) => isRepository(space, project(path)),
    async init(path) {
      const folder = project(path);
      if (!(await isRepository(space, folder))) {
        await space.createDirectory(joinPath(folder, GIT_DIR));
        await space.writeTextFile(headOf(folder), `ref: refs/heads/${DEFAULT_BRANCH}\n`);
      }
      return (await engine.info(folder))!;
    },
    async info(path) {
      const folder = project(path);
      if (!(await isRepository(space, folder))) return null;
      const head = (await space.readTextFile(headOf(folder)).catch(() => '')).trim();
      const ref = 'ref: refs/heads/';
      return { branch: head.startsWith(ref) ? head.slice(ref.length) : 'HEAD', hasCommits: false };
    },
  };
  return engine;
}
