import { useEffect, useState } from 'react';
import { errorMessage } from './errors';
import type { FileEntry } from './files';
import type { ProjectSpace } from './projectSpace';
import { canBeProject, MARKER_DIR, readProject } from './projects';

export type DirectoryListing =
  | {
      ok: true;
      /** Without Pepino's own `.pepino` folders. */
      entries: FileEntry[];
      /** Paths of the entries that are projects (only filled when detection is on). */
      projects: ReadonlySet<string>;
    }
  | { ok: false; message: string };

const NO_PROJECTS: ReadonlySet<string> = new Set();

async function load(space: ProjectSpace, path: string, detectProjects: boolean): Promise<DirectoryListing> {
  const entries = (await space.listDirectory(path)).filter((entry) => entry.name !== MARKER_DIR);
  if (!detectProjects) return { ok: true, entries, projects: NO_PROJECTS };
  const candidates = entries.filter((entry) => entry.isDirectory && canBeProject(entry.path));
  const found = await Promise.all(candidates.map((entry) => readProject(space, entry.path).catch(() => null)));
  return { ok: true, entries, projects: new Set(found.flatMap((project) => (project ? [project.path] : []))) };
}

/**
 * Lists [path], re-listing whenever [refreshTick] changes. Returns null while
 * a new path loads; a refresh of the same path keeps showing the previous
 * result instead of flashing LOADING. With [detectProjects], top-level
 * folders are checked for a project marker before the listing is shown.
 */
export function useDirectoryListing(
  projectSpace: ProjectSpace,
  path: string,
  refreshTick = 0,
  detectProjects = false,
): DirectoryListing | null {
  const [state, setState] = useState<{ path: string; listing: DirectoryListing } | null>(null);

  useEffect(() => {
    let active = true;
    load(projectSpace, path, detectProjects).then(
      (listing) => {
        if (active) setState({ path, listing });
      },
      (error: unknown) => {
        if (active) setState({ path, listing: { ok: false, message: errorMessage(error) } });
      },
    );
    return () => {
      active = false;
    };
  }, [projectSpace, path, refreshTick, detectProjects]);

  return state?.path === path ? state.listing : null;
}
