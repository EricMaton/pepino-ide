import { useEffect, useState } from 'react';
import type { RecentProject, RecentProjects } from './recents';

export interface LoadedRecents {
  recents: RecentProject[];
  /** When they were loaded: "5M AGO" is relative to it, which keeps rendering pure. */
  at: number;
}

/** The recent projects, loaded once per mount; null until then. */
export function useRecentProjects(store: RecentProjects): LoadedRecents | null {
  const [loaded, setLoaded] = useState<LoadedRecents | null>(null);
  useEffect(() => {
    let active = true;
    store.load().then(
      (recents) => {
        if (active) setLoaded({ recents, at: Date.now() });
      },
      (error: unknown) => console.error('Cannot load recent projects', error),
    );
    return () => {
      active = false;
    };
  }, [store]);
  return loaded;
}
