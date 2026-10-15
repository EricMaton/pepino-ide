import { useEffect, useState } from 'react';
import { errorMessage } from './errors';
import type { FileEntry } from './files';
import type { ProjectSpace } from './projectSpace';

export type DirectoryListing = { ok: true; entries: FileEntry[] } | { ok: false; message: string };

/**
 * Lists [path], re-listing whenever [refreshTick] changes. Returns null while
 * a new path loads; a refresh of the same path keeps showing the previous
 * result instead of flashing LOADING.
 */
export function useDirectoryListing(
  projectSpace: ProjectSpace,
  path: string,
  refreshTick = 0,
): DirectoryListing | null {
  const [state, setState] = useState<{ path: string; listing: DirectoryListing } | null>(null);

  useEffect(() => {
    let active = true;
    projectSpace.listDirectory(path).then(
      (entries) => {
        if (active) setState({ path, listing: { ok: true, entries } });
      },
      (error: unknown) => {
        if (active) setState({ path, listing: { ok: false, message: errorMessage(error) } });
      },
    );
    return () => {
      active = false;
    };
  }, [projectSpace, path, refreshTick]);

  return state?.path === path ? state.listing : null;
}
