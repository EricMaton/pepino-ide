import { basename, isWithin, parentPath } from '../features/projects/paths';
import { type ProjectInfo, readProject } from '../features/projects/projects';
import type { ProjectSpace } from '../features/projects/projectSpace';
import type { EditorViewState, Session } from './session';

export interface RestoredSession {
  project: ProjectInfo | null;
  /** Explorer path stack for the restored root, when every folder still exists. */
  stack: string[] | null;
  openFile: string | null;
  editors: Record<string, EditorViewState>;
}

async function isFolder(space: ProjectSpace, path: string): Promise<boolean> {
  try {
    await space.listDirectory(path);
    return true;
  } catch {
    return false;
  }
}

async function isFile(space: ProjectSpace, path: string): Promise<boolean> {
  try {
    const siblings = await space.listDirectory(parentPath(path));
    return siblings.some((entry) => entry.path === path && !entry.isDirectory);
  } catch {
    return false;
  }
}

/** A stack is usable when it starts at [root], each step goes one folder deeper, and the last folder exists. */
async function isUsableStack(space: ProjectSpace, root: string, stack: string[]): Promise<boolean> {
  if (stack[0] !== root) return false;
  for (let i = 1; i < stack.length; i++) {
    if (parentPath(stack[i]) !== stack[i - 1] || basename(stack[i]) === '') return false;
  }
  return isFolder(space, stack[stack.length - 1]);
}

/**
 * Checks a saved session against what is on disk now: anything deleted,
 * renamed or no longer a project since last time is dropped, never an error.
 */
export async function restoreSession(space: ProjectSpace, saved: Session): Promise<RestoredSession> {
  const project = saved.project ? await readProject(space, saved.project).catch(() => null) : null;
  const root = project?.path ?? '';
  const savedStack = saved.explorer[root];
  const stack = savedStack && (await isUsableStack(space, root, savedStack)) ? savedStack : null;
  const openFile =
    saved.openFile && isWithin(saved.openFile, root) && (await isFile(space, saved.openFile)) ? saved.openFile : null;
  const editors = Object.fromEntries(
    Object.entries(saved.editors).map(([path, { anchor, head, scrollTop }]) => [path, { anchor, head, scrollTop }]),
  );
  return { project, stack, openFile, editors };
}
