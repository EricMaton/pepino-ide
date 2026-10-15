import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryBackend } from './memoryBackend';
import { createProject } from './projects';
import { createProjectSpace, type ProjectSpace } from './projectSpace';
import type { KeyValueStore } from '../../core/storage';
import { createRecentProjects, formatAgo, MAX_RECENTS, withOpened } from './recents';

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async get(key) {
      return data.get(key) ?? null;
    },
    async set(key, value) {
      data.set(key, value);
    },
  };
}

let space: ProjectSpace;
let store: ReturnType<typeof memoryStore>;
let clock: number;

beforeEach(async () => {
  space = createProjectSpace(createMemoryBackend(() => 1000));
  await space.ensureCreated();
  store = memoryStore();
  clock = 1_000;
});

const recents = () => createRecentProjects(store, space, () => clock);

describe('withOpened', () => {
  it('moves the project to the front without duplicates and caps the list', () => {
    let entries = withOpened([], 'a', 1);
    entries = withOpened(entries, 'b', 2);
    entries = withOpened(entries, 'a', 3);
    expect(entries).toEqual([
      { path: 'a', openedMillis: 3 },
      { path: 'b', openedMillis: 2 },
    ]);
    const many = Array.from({ length: MAX_RECENTS + 3 }, (_, i) => `p${i}`).reduce(
      (list, path, i) => withOpened(list, path, i),
      withOpened([], 'start', 0),
    );
    expect(many).toHaveLength(MAX_RECENTS);
    expect(many[0].path).toBe(`p${MAX_RECENTS + 2}`);
  });
});

describe('createRecentProjects', () => {
  it('returns projects most recent first, with their info', async () => {
    await createProject(space, 'alpha', () => 5);
    await createProject(space, 'beta', () => 6);
    const list = recents();
    await list.record('alpha');
    clock = 2_000;
    await list.record('beta');
    expect(await list.load()).toEqual([
      { path: 'beta', name: 'beta', createdMillis: 6, openedMillis: 2_000 },
      { path: 'alpha', name: 'alpha', createdMillis: 5, openedMillis: 1_000 },
    ]);
  });

  it('persists across instances (app restarts)', async () => {
    await createProject(space, 'alpha');
    await recents().record('alpha');
    expect((await recents().load()).map((p) => p.name)).toEqual(['alpha']);
  });

  it('forgets projects that were deleted, renamed or unmarked', async () => {
    await createProject(space, 'gone');
    await createProject(space, 'renamed');
    await createProject(space, 'kept');
    const list = recents();
    for (const path of ['gone', 'renamed', 'kept']) await list.record(path);
    await space.delete('gone');
    await space.rename('renamed', 'other');

    expect((await list.load()).map((p) => p.name)).toEqual(['kept']);
    expect(JSON.parse(store.data.get('pepino.recentProjects')!)).toEqual([{ path: 'kept', openedMillis: 1_000 }]);
  });

  it('survives corrupt storage', async () => {
    store.data.set('pepino.recentProjects', '{oops');
    expect(await recents().load()).toEqual([]);
    store.data.set('pepino.recentProjects', JSON.stringify([{ path: 1 }, 'x', null]));
    expect(await recents().load()).toEqual([]);
  });

  it('does not lose writes when opens happen back to back', async () => {
    await createProject(space, 'a');
    await createProject(space, 'b');
    const list = recents();
    await Promise.all([list.record('a'), list.record('b')]);
    expect((await list.load()).map((p) => p.name).sort()).toEqual(['a', 'b']);
  });
});

describe('formatAgo', () => {
  const now = new Date(2026, 9, 15, 12, 0).getTime();
  it.each([
    [now - 10_000, 'JUST NOW'],
    [now - 5 * 60_000, '5M AGO'],
    [now - 3 * 3_600_000, '3H AGO'],
    [now - 2 * 86_400_000, '2D AGO'],
    [new Date(2026, 8, 1, 9, 0).getTime(), '2026-09-01'],
  ])('formats %d as %j', (millis, expected) => {
    expect(formatAgo(millis, now)).toBe(expected);
  });
});
