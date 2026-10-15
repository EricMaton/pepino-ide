import type { FsBackend, FsStat } from './projectSpace';
import { basename, isWithin, parentPath } from './paths';

/** In-memory [FsBackend] for tests. Mirrors a real filesystem: parents must exist. */
export function createMemoryBackend(now: () => number = Date.now): FsBackend & {
  nodes: Map<string, FsStat & { content?: string }>;
} {
  const nodes = new Map<string, FsStat & { content?: string }>();

  const requireParent = (path: string) => {
    if (!nodes.get(parentPath(path))?.isDirectory) throw new Error(`No parent directory: ${path}`);
  };
  const subtree = (path: string) => [...nodes.keys()].filter((key) => isWithin(key, path));
  const relocate = (key: string, from: string, to: string) => to + key.slice(from.length);

  return {
    nodes,

    async stat(path) {
      const node = nodes.get(path);
      return node
        ? { isDirectory: node.isDirectory, sizeBytes: node.sizeBytes, modifiedMillis: node.modifiedMillis }
        : null;
    },

    async list(path) {
      return [...nodes.entries()]
        .filter(([key]) => key !== '' && key !== path && parentPath(key) === path)
        .map(([key, node]) => ({
          name: basename(key),
          isDirectory: node.isDirectory,
          sizeBytes: node.sizeBytes,
          modifiedMillis: node.modifiedMillis,
        }));
    },

    async mkdir(path) {
      if (path !== '') requireParent(path);
      nodes.set(path, { isDirectory: true, sizeBytes: 0, modifiedMillis: now() });
    },

    async writeEmpty(path) {
      requireParent(path);
      nodes.set(path, { isDirectory: false, sizeBytes: 0, modifiedMillis: now(), content: '' });
    },

    async rename(from, to) {
      requireParent(to);
      for (const key of subtree(from)) {
        const node = nodes.get(key)!;
        nodes.delete(key);
        nodes.set(relocate(key, from, to), node);
      }
    },

    async copy(from, to) {
      requireParent(to);
      for (const key of subtree(from)) {
        nodes.set(relocate(key, from, to), { ...nodes.get(key)! });
      }
    },

    async remove(path) {
      for (const key of subtree(path)) nodes.delete(key);
    },
  };
}
