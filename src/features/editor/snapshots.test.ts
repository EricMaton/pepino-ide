import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryBackend } from '../projects/memoryBackend';
import { createProjectSpace, type ProjectSpace } from '../projects/projectSpace';
import { listSnapshots, SNAPSHOTS_KEPT, snapshotsDirFor, takeSnapshot } from './snapshots';

let space: ProjectSpace;
let clock: number;
const now = () => clock;

beforeEach(async () => {
  space = createProjectSpace(createMemoryBackend(() => 1));
  await space.ensureCreated();
  await space.createDirectory('app');
  await space.createDirectory('app/src');
  clock = 1_000;
});

describe('snapshots', () => {
  it('lives in the top-level folder, or the space root for loose files', () => {
    expect(snapshotsDirFor('app/src/main.ts')).toBe('app/.pepino/snapshots');
    expect(snapshotsDirFor('notes.md')).toBe('.pepino/snapshots');
  });

  it('stores the content and lists snapshots newest first', async () => {
    await takeSnapshot(space, 'app/src/main.ts', 'v1', now);
    clock = 2_000;
    await takeSnapshot(space, 'app/src/main.ts', 'v2', now);

    const snapshots = await listSnapshots(space, 'app/src/main.ts');
    expect(snapshots.map((s) => s.takenMillis)).toEqual([2_000, 1_000]);
    expect(await space.readTextFile(snapshots[0].path)).toBe('v2');
    expect(await space.readTextFile(snapshots[1].path)).toBe('v1');
  });

  it('keeps files with similar names apart', async () => {
    await takeSnapshot(space, 'app/src/main.ts', 'a', now);
    await takeSnapshot(space, 'app/main.ts', 'b', now);
    expect(await listSnapshots(space, 'app/src/main.ts')).toHaveLength(1);
    expect(await listSnapshots(space, 'app/main.ts')).toHaveLength(1);
  });

  it(`keeps only the newest ${SNAPSHOTS_KEPT}`, async () => {
    for (let i = 0; i < SNAPSHOTS_KEPT + 3; i++) {
      clock = 1_000 + i;
      await takeSnapshot(space, 'app/src/main.ts', `v${i}`, now);
    }
    const snapshots = await listSnapshots(space, 'app/src/main.ts');
    expect(snapshots).toHaveLength(SNAPSHOTS_KEPT);
    expect(await space.readTextFile(snapshots[0].path)).toBe(`v${SNAPSHOTS_KEPT + 2}`);
  });

  it('works for loose files at the space root and reports none when there are none', async () => {
    expect(await listSnapshots(space, 'notes.md')).toEqual([]);
    await takeSnapshot(space, 'notes.md', 'x', now);
    expect(await listSnapshots(space, 'notes.md')).toHaveLength(1);
  });
});
