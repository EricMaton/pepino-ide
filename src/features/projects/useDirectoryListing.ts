import { useEffect, useState } from 'react';
import { errorMessage } from './errors';
import type { FileEntry } from './files';
import type { ProjectSpace } from './projectSpace';
import { isRepository, MARKER_DIR } from './projects';

export type DirectoryListing =
  | {
      ok: true;
      /** Without Pepino's own `.pepino` folders. */
      entries: FileEntry[];
      /** Paths of the folders that are git repositories (only filled when detection is on). */
      repos: ReadonlySet<string>;
    }
  | { ok: false; message: string };

const NO_REPOS: ReadonlySet<string> = new Set();

async function load(space: ProjectSpace, path: string, detectRepos: boolean): Promise<DirectoryListing> {
  const entries = (await space.listDirectory(path)).filter((entry) => entry.name !== MARKER_DIR);
  if (!detectRepos) return { ok: true, entries, repos: NO_REPOS };
  const folders = entries.filter((entry) => entry.isDirectory);
  const found = await Promise.all(folders.map((folder) => isRepository(space, folder.path)));
  return { ok: true, entries, repos: new Set(folders.filter((_, i) => found[i]).map((folder) => folder.path)) };
}

/**
 * Lists [path], re-listing whenever [refreshTick] changes. Returns null while
 * a new path loads; a refresh of the same path keeps showing the previous
 * result instead of flashing LOADING. With [detectRepos], every folder is
 * checked for a `.git` before the listing is shown (one read per folder, so
 * only near the top of the space).
 */
export function useDirectoryListing(
  projectSpace: ProjectSpace,
  path: string,
  refreshTick = 0,
  detectRepos = false,
): DirectoryListing | null {
  const [state, setState] = useState<{ path: string; listing: DirectoryListing } | null>(null);

  useEffect(() => {
    let active = true;
    load(projectSpace, path, detectRepos).then(
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
  }, [projectSpace, path, refreshTick, detectRepos]);

  return state?.path === path ? state.listing : null;
}
