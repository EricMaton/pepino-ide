import type { GitEngine } from '../git/engine';
import { parentPath, resolveInRoot } from '../projects/paths';
import { isRepository } from '../projects/projects';
import type { ProjectSpace } from '../projects/projectSpace';
import { listSnapshots, takeSnapshot } from './snapshots';

/*
 * A file's earlier versions (#27). Before the editor first overwrites a file,
 * how it was is kept: inside a git repository as a snapshot of the whole
 * repository on Pepino's own ref (GitEngine.snapshot, which branch switches
 * take too), elsewhere as a copy in `.pepino/snapshots` (./snapshots). Both
 * kinds show as one list, so versions kept before a folder became a
 * repository are still there.
 */

export interface FileVersion {
  /** A git snapshot's id, or the copy's path. */
  id: string;
  source: 'git' | 'copy';
  time: number;
  /** Why it was kept, e.g. "Before editing src/app.ts". */
  reason: string;
}

export interface FileHistory {
  /**
   * Keeps [path] as it is before it is overwritten: in a repository, a
   * snapshot of the repository (the file on disk is [previous] then);
   * elsewhere, a copy of [previous].
   */
  beforeOverwrite(path: string, previous: string, reason?: string): Promise<void>;
  /** [path]'s earlier versions, newest first. */
  versions(path: string): Promise<FileVersion[]>;
  /** [path]'s text in [version]; null when that version has no such file. */
  read(path: string, version: FileVersion): Promise<string | null>;
}

/** The repository [path] is in: the nearest folder above it with `.git`, or null. */
export async function repositoryOf(space: ProjectSpace, path: string): Promise<string | null> {
  for (let dir = parentPath(resolveInRoot(path)); dir !== ''; dir = parentPath(dir)) {
    if (await isRepository(space, dir)) return dir;
  }
  return null;
}

export function createFileHistory(space: ProjectSpace, git: GitEngine): FileHistory {
  const inRepository = async (path: string) => {
    const repo = await repositoryOf(space, path);
    return repo === null ? null : { repo, file: resolveInRoot(path).slice(repo.length + 1) };
  };

  return {
    async beforeOverwrite(path, previous, reason) {
      const found = await inRepository(path);
      if (found) {
        try {
          await git.snapshot(found.repo, reason ?? `Before editing ${found.file}`);
          return;
        } catch (error) {
          // A repository git can't read still gets the copy: the version is never lost.
          console.error(`Cannot snapshot ${found.repo}, keeping a copy instead`, error);
        }
      }
      await takeSnapshot(space, path, previous);
    },

    async versions(path) {
      const found = await inRepository(path);
      const [snapshots, copies] = await Promise.all([
        found ? git.snapshotVersions(found.repo, found.file).catch(() => []) : [],
        listSnapshots(space, path),
      ]);
      return [
        ...snapshots.map((version): FileVersion => ({ ...version, source: 'git' })),
        ...copies.map((copy): FileVersion => ({
          id: copy.path,
          source: 'copy',
          time: copy.takenMillis,
          reason: 'Before editing',
        })),
      ].sort((a, b) => b.time - a.time);
    },

    async read(path, version) {
      if (version.source === 'copy') return space.readTextFile(version.id);
      const found = await inRepository(path);
      if (!found) return null;
      return git.snapshotFile(found.repo, version.id, found.file);
    },
  };
}
