import { ProjectSpaceError } from './errors';
import type { FileEntry } from './files';
import { basename, resolveInRoot } from './paths';
import type { ProjectSpace } from './projectSpace';

/*
 * A project (the workspace) is any folder of the project space the user opens
 * to work in, at any depth; the space root itself never is one. Nothing marks
 * a folder first: Pepino keeps its own data in a `.pepino` folder inside it,
 * created only when something needs it (snapshots). A project is a git
 * repository when it has a `.git` folder, which only appears when the user
 * asks for it (#22).
 */
export const MARKER_DIR = '.pepino';
export const GIT_DIR = '.git';

export interface ProjectInfo {
  /** Root-relative path of the project folder. */
  path: string;
  name: string;
}

/** Names the UI must not let users create or rename to: they belong to Pepino. */
export function isReservedName(name: string): boolean {
  return name.trim() === MARKER_DIR;
}

/** Any folder can be opened as a project except the space root. */
export function canBeProject(path: string): boolean {
  return resolveInRoot(path) !== '';
}

const isGone = (error: unknown) =>
  error instanceof ProjectSpaceError && (error.code === 'NotFound' || error.code === 'NotADirectory');

/** The project at [path], or null when there is no folder there (or it is the space root). */
export async function readProject(space: ProjectSpace, path: string): Promise<ProjectInfo | null> {
  if (!canBeProject(path)) return null;
  try {
    await space.listDirectory(path);
  } catch (error) {
    if (isGone(error)) return null;
    throw error;
  }
  const resolved = resolveInRoot(path);
  return { path: resolved, name: basename(resolved) };
}

/** True when a folder listing contains a git repository's `.git` folder. */
export function hasGitDir(entries: readonly FileEntry[]): boolean {
  return entries.some((entry) => entry.isDirectory && entry.name === GIT_DIR);
}

/** Whether the folder at [path] is a git repository; false when it is gone. */
export async function isRepository(space: ProjectSpace, path: string): Promise<boolean> {
  try {
    return hasGitDir(await space.listDirectory(path));
  } catch {
    return false;
  }
}
