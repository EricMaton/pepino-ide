import { readProject, type ProjectInfo } from './projects';
import type { ProjectSpace } from './projectSpace';

/** Minimal persistent string store; Capacitor Preferences in the app, a Map in tests. */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface RecentProject extends ProjectInfo {
  openedMillis: number;
}

interface StoredEntry {
  path: string;
  openedMillis: number;
}

const STORAGE_KEY = 'pepino.recentProjects';
export const MAX_RECENTS = 8;

/** Moves [path] to the front, keeping at most [max] entries. */
export function withOpened(
  entries: readonly StoredEntry[],
  path: string,
  now: number,
  max = MAX_RECENTS,
): StoredEntry[] {
  return [{ path, openedMillis: now }, ...entries.filter((entry) => entry.path !== path)].slice(0, max);
}

function parse(raw: string | null): StoredEntry[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(
      (entry): entry is StoredEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as StoredEntry).path === 'string' &&
        typeof (entry as StoredEntry).openedMillis === 'number',
    );
  } catch {
    return [];
  }
}

export interface RecentProjects {
  /** Most recent first. Projects that no longer exist are dropped (and forgotten). */
  load(): Promise<RecentProject[]>;
  record(path: string): Promise<void>;
}

export function createRecentProjects(
  store: KeyValueStore,
  space: ProjectSpace,
  now: () => number = Date.now,
): RecentProjects {
  // Serializes writes so two quick opens never overwrite each other.
  let queue: Promise<unknown> = Promise.resolve();
  const update = (change: (entries: StoredEntry[]) => StoredEntry[] | Promise<StoredEntry[]>) => {
    const next = queue.then(async () => {
      const before = parse(await store.get(STORAGE_KEY));
      const after = await change(before);
      if (JSON.stringify(after) !== JSON.stringify(before)) await store.set(STORAGE_KEY, JSON.stringify(after));
      return after;
    });
    queue = next.catch(() => undefined);
    return next;
  };

  return {
    async load() {
      const recents: RecentProject[] = [];
      await update(async (entries) => {
        const kept: StoredEntry[] = [];
        for (const entry of entries) {
          const project = await readProject(space, entry.path).catch(() => null);
          if (!project) continue;
          kept.push(entry);
          recents.push({ ...project, openedMillis: entry.openedMillis });
        }
        return kept;
      });
      return recents;
    },

    async record(path) {
      await update((entries) => withOpened(entries, path, now()));
    },
  };
}

/** "JUST NOW", "5M AGO", "3H AGO", "2D AGO", then the date. */
export function formatAgo(millis: number, now: number): string {
  const minutes = Math.floor((now - millis) / 60_000);
  if (minutes < 1) return 'JUST NOW';
  if (minutes < 60) return `${minutes}M AGO`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}H AGO`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}D AGO`;
  const date = new Date(millis);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
