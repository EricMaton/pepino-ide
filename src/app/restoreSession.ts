import { basename, parentPath } from '../features/projects/paths';
import { type ProjectInfo, readProject } from '../features/projects/projects';
import type { ProjectSpace } from '../features/projects/projectSpace';
import type { EditorViewState, Session } from './session';

export interface RestoredSession {
  /** The active project; its tabs come back through the workspace. */
  project: ProjectInfo | null;
  /** Whether to show the project's workspace (rather than the explorer). */
  inWorkspace: boolean;
  /** The explorer's path stack, when every folder still exists. */
  stack: string[] | null;
  /** The file open on its own over the explorer. */
  looseFile: string | null;
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
 * Checks a saved session against what is on disk now: anything deleted or
 * renamed since last time is dropped, never an error.
 */
export async function restoreSession(space: ProjectSpace, saved: Session): Promise<RestoredSession> {
  const project = saved.project ? await readProject(space, saved.project).catch(() => null) : null;
  const savedStack = saved.explorer[''];
  const stack = savedStack && (await isUsableStack(space, '', savedStack)) ? savedStack : null;
  const looseFile = saved.looseFile && (await isFile(space, saved.looseFile)) ? saved.looseFile : null;
  // A loose file belongs to the explorer, so it wins over the workspace.
  const inWorkspace = project !== null && saved.inWorkspace && looseFile === null;
  const editors = Object.fromEntries(
    Object.entries(saved.editors).map(([path, { anchor, head, scrollTop }]) => [path, { anchor, head, scrollTop }]),
  );
  return { project, inWorkspace, stack, looseFile, editors };
}
