import type { FileEntry } from '../projects/files';
import { isValidEntryName } from '../projects/files';
import { GIT_DIR, isReservedName } from '../projects/projects';

/* Where a new repository goes (created or cloned): its name, and a folder of ~/projects. */

/** `~/projects/…` for a folder of the space. */
export const shown = (path: string) => (path === '' ? '~/projects' : `~/projects/${path}`);

export const isGitDir = (folder: FileEntry) => folder.name === GIT_DIR;

/** Why [name] cannot be a new folder in [location], whose entries are [taken]; null when it can (or is empty). */
export function nameError(name: string, taken: ReadonlySet<string>, location: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return null;
  if (isReservedName(trimmed)) return 'Reserved name';
  if (!isValidEntryName(trimmed)) return 'Invalid name';
  return taken.has(trimmed) ? `Already in ${shown(location)}` : null;
}
