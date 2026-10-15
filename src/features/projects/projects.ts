import { ProjectSpaceError } from './errors';
import { basename, joinPath, parentPath, resolveInRoot } from './paths';
import type { ProjectSpace } from './projectSpace';

/*
 * A project is a folder at the top level of the project space that carries a
 * marker file. The marker lives inside the folder, so renaming or moving the
 * folder keeps it a project; the project's name is always the folder name.
 */
export const MARKER_DIR = '.pepino';
export const MARKER_FILE = `${MARKER_DIR}/project.json`;

const MARKER_VERSION = 1;

export interface ProjectInfo {
  /** Root-relative path of the project folder. */
  path: string;
  name: string;
  createdMillis: number;
}

interface Marker {
  version: number;
  createdMillis: number;
}

/** Names the UI must not let users create or rename to: they belong to Pepino. */
export function isReservedName(name: string): boolean {
  return name.trim() === MARKER_DIR;
}

/** Projects only live at the top level of the project space. */
export function canBeProject(path: string): boolean {
  const resolved = resolveInRoot(path);
  return resolved !== '' && parentPath(resolved) === '';
}

/** The project at [path], or null when the folder carries no marker. */
export async function readProject(space: ProjectSpace, path: string): Promise<ProjectInfo | null> {
  if (!canBeProject(path)) return null;
  let raw: string;
  try {
    raw = await space.readTextFile(joinPath(path, MARKER_FILE));
  } catch (error) {
    if (error instanceof ProjectSpaceError && error.code === 'NotFound') return null;
    throw error;
  }
  // A damaged marker still marks a project; only its metadata is lost.
  let createdMillis = 0;
  try {
    const marker = JSON.parse(raw) as Partial<Marker>;
    if (typeof marker.createdMillis === 'number') createdMillis = marker.createdMillis;
  } catch {
    // keep the defaults
  }
  return { path: resolveInRoot(path), name: basename(path), createdMillis };
}

/** Turns an existing top-level folder into a project. Idempotent. */
export async function markAsProject(
  space: ProjectSpace,
  path: string,
  now: () => number = Date.now,
): Promise<ProjectInfo> {
  if (!canBeProject(path)) {
    throw new ProjectSpaceError('InvalidName', 'Only top-level folders can be projects');
  }
  const existing = await readProject(space, path);
  if (existing) return existing;

  const markerDir = joinPath(path, MARKER_DIR);
  try {
    await space.createDirectory(markerDir);
  } catch (error) {
    if (!(error instanceof ProjectSpaceError && error.code === 'AlreadyExists')) throw error;
  }
  const marker: Marker = { version: MARKER_VERSION, createdMillis: now() };
  await space.writeTextFile(joinPath(path, MARKER_FILE), `${JSON.stringify(marker, null, 2)}\n`);
  return { path: resolveInRoot(path), name: basename(path), createdMillis: marker.createdMillis };
}

/** Creates a new, empty project folder at the top level. */
export async function createProject(
  space: ProjectSpace,
  name: string,
  now: () => number = Date.now,
): Promise<ProjectInfo> {
  if (isReservedName(name)) throw new ProjectSpaceError('InvalidName', `Reserved name: ${name.trim()}`);
  const path = name.trim();
  await space.createDirectory(path);
  return markAsProject(space, path, now);
}

/** Every project in the space, in no particular order. */
export async function listProjects(space: ProjectSpace): Promise<ProjectInfo[]> {
  const folders = (await space.listDirectory('')).filter((entry) => entry.isDirectory);
  const projects = await Promise.all(folders.map((folder) => readProject(space, folder.path)));
  return projects.filter((project): project is ProjectInfo => project !== null);
}
