import type { KeyValueStore } from '../../core/storage';
import { isRepository, readProject, type ProjectInfo } from '../projects/projects';
import type { ProjectSpace } from '../projects/projectSpace';
import { resolveInRoot } from '../projects/paths';

/*
 * GitHub Desktop's repository list: the repositories the user added to Pepino
 * (adding one already on the device, creating or initializing one). Nothing
 * else of ~/projects shows in GIT until it is added.
 */
const STORAGE_KEY = 'pepino.repositories';

function parse(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((path): path is string => typeof path === 'string') : [];
  } catch {
    return [];
  }
}

const byName = (a: ProjectInfo, b: ProjectInfo) =>
  a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.path.localeCompare(b.path);

export interface Repositories {
  /** By name. Folders gone or no longer repositories are dropped (and forgotten). */
  load(): Promise<ProjectInfo[]>;
  /** Remembers [path]; adding one already there changes nothing. */
  add(path: string): Promise<void>;
  /** Called after every change to the list; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

export function createRepositories(store: KeyValueStore, space: ProjectSpace): Repositories {
  const listeners = new Set<() => void>();
  // Serializes writes so two quick adds never overwrite each other.
  let queue: Promise<unknown> = Promise.resolve();
  const update = (change: (paths: string[]) => string[] | Promise<string[]>) => {
    const next = queue.then(async () => {
      const before = parse(await store.get(STORAGE_KEY));
      const after = await change(before);
      const changed = JSON.stringify(after) !== JSON.stringify(before);
      if (changed) await store.set(STORAGE_KEY, JSON.stringify(after));
      return changed;
    });
    queue = next.catch(() => undefined);
    return next;
  };

  return {
    async load() {
      const repos: ProjectInfo[] = [];
      await update(async (paths) => {
        const kept: string[] = [];
        for (const path of paths) {
          const project = await readProject(space, path).catch(() => null);
          if (!project || !(await isRepository(space, path))) continue;
          kept.push(path);
          repos.push(project);
        }
        return kept;
      });
      return repos.sort(byName);
    },

    async add(path) {
      const resolved = resolveInRoot(path);
      const changed = await update((paths) => (paths.includes(resolved) ? paths : [...paths, resolved]));
      if (changed) listeners.forEach((listener) => listener());
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
