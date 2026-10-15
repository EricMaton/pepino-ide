import { basename, joinPath, parentPath, resolveInRoot } from './paths';
import type { ProjectSpace } from './projectSpace';

/**
 * File-system change events, published after a change succeeds, whoever made
 * it (explorer, editor, workspace API, plugins). Paths are root-relative.
 */
export type FsEvents = {
  'fs.created': { path: string };
  /** File contents written (the file may be new). */
  'fs.written': { path: string };
  /** Renamed or moved; [to] is the new path. */
  'fs.moved': { from: string; to: string };
  'fs.deleted': { path: string };
};

type Publish = <K extends keyof FsEvents>(topic: K, payload: FsEvents[K]) => void;

/** The same project space, announcing every successful change through [publish]. */
export function observeProjectSpace(space: ProjectSpace, publish: Publish): ProjectSpace {
  return {
    ...space,
    async createFile(path) {
      await space.createFile(path);
      publish('fs.created', { path: resolveInRoot(path) });
    },
    async createDirectory(path) {
      await space.createDirectory(path);
      publish('fs.created', { path: resolveInRoot(path) });
    },
    async writeTextFile(path, text) {
      await space.writeTextFile(path, text);
      publish('fs.written', { path: resolveInRoot(path) });
    },
    async rename(path, newName) {
      await space.rename(path, newName);
      const from = resolveInRoot(path);
      const to = joinPath(parentPath(from), newName.trim());
      if (to !== from) publish('fs.moved', { from, to });
    },
    async move(source, destinationDir) {
      await space.move(source, destinationDir);
      const from = resolveInRoot(source);
      publish('fs.moved', { from, to: joinPath(resolveInRoot(destinationDir), basename(from)) });
    },
    async copy(source, destinationDir) {
      await space.copy(source, destinationDir);
      publish('fs.created', { path: joinPath(resolveInRoot(destinationDir), basename(resolveInRoot(source))) });
    },
    async delete(path) {
      await space.delete(path);
      publish('fs.deleted', { path: resolveInRoot(path) });
    },
  };
}
