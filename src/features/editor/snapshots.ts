import { ProjectSpaceError } from '../projects/errors';
import { joinPath, resolveInRoot } from '../projects/paths';
import { MARKER_DIR } from '../projects/projects';
import type { ProjectSpace } from '../projects/projectSpace';

/*
 * Pre-edit snapshots: before a file is overwritten for the first time in an
 * editing session, its previous content is copied to
 * `<top-level folder>/.pepino/snapshots/` (or the space root for loose
 * files). Git snapshots (#27) will build on the same idea.
 */
export const SNAPSHOTS_KEPT = 10;

export interface Snapshot {
  /** Root-relative path of the snapshot file itself. */
  path: string;
  takenMillis: number;
}

/** Where snapshots of [filePath] live and how their names start. */
function locate(filePath: string): { dir: string; prefix: string } {
  const path = resolveInRoot(filePath);
  const [top, ...rest] = path.split('/');
  const owner = rest.length > 0 ? top : '';
  const relative = rest.length > 0 ? rest.join('/') : path;
  return {
    dir: joinPath(joinPath(owner, MARKER_DIR), 'snapshots'),
    prefix: `${encodeURIComponent(relative)}@`,
  };
}

async function ensureDir(space: ProjectSpace, dir: string): Promise<void> {
  const parts = dir.split('/');
  for (let i = 1; i <= parts.length; i++) {
    try {
      await space.createDirectory(parts.slice(0, i).join('/'));
    } catch (error) {
      if (!(error instanceof ProjectSpaceError && error.code === 'AlreadyExists')) throw error;
    }
  }
}

/** Snapshots of [filePath], newest first. */
export async function listSnapshots(space: ProjectSpace, filePath: string): Promise<Snapshot[]> {
  const { dir, prefix } = locate(filePath);
  let entries;
  try {
    entries = await space.listDirectory(dir);
  } catch (error) {
    if (error instanceof ProjectSpaceError && error.code === 'NotFound') return [];
    throw error;
  }
  return entries
    .filter((entry) => !entry.isDirectory && entry.name.startsWith(prefix) && entry.name.endsWith('.snap'))
    .map((entry) => ({ path: entry.path, takenMillis: Number(entry.name.slice(prefix.length, -'.snap'.length)) }))
    .filter((snapshot) => Number.isFinite(snapshot.takenMillis))
    .sort((a, b) => b.takenMillis - a.takenMillis);
}

/** Stores [content] as a snapshot of [filePath] and prunes all but the newest [SNAPSHOTS_KEPT]. */
export async function takeSnapshot(
  space: ProjectSpace,
  filePath: string,
  content: string,
  now: () => number = Date.now,
): Promise<Snapshot> {
  const { dir, prefix } = locate(filePath);
  await ensureDir(space, dir);
  const takenMillis = now();
  const snapshot = { path: joinPath(dir, `${prefix}${takenMillis}.snap`), takenMillis };
  await space.writeTextFile(snapshot.path, content);
  const stale = (await listSnapshots(space, filePath)).slice(SNAPSHOTS_KEPT);
  await Promise.all(stale.map((old) => space.delete(old.path)));
  return snapshot;
}

/** The parent folder of the snapshots, exposed for tests and tooling. */
export function snapshotsDirFor(filePath: string): string {
  return locate(filePath).dir;
}
