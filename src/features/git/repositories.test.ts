import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeyValueStore } from '../../core/storage';
import { createMemoryBackend } from '../projects/memoryBackend';
import { createProjectSpace, type ProjectSpace } from '../projects/projectSpace';
import { createRepositories } from './repositories';

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

const repository = async (path: string) => {
  await space.createDirectory(path);
  await space.createDirectory(`${path}/.git`);
};

beforeEach(async () => {
  space = createProjectSpace(createMemoryBackend(() => 1000));
  await space.ensureCreated();
  store = memoryStore();
});

describe('createRepositories', () => {
  it('starts empty: repositories on the device are not listed until added', async () => {
    await repository('app');
    expect(await createRepositories(store, space).load()).toEqual([]);
  });

  it('lists the added repositories by name, at any depth', async () => {
    await repository('zeta');
    await space.createDirectory('work');
    await repository('work/alpha');
    const repos = createRepositories(store, space);
    await repos.add('zeta');
    await repos.add('work/alpha');
    expect(await repos.load()).toEqual([
      { path: 'work/alpha', name: 'alpha' },
      { path: 'zeta', name: 'zeta' },
    ]);
    // and they are remembered
    expect(await createRepositories(store, space).load()).toHaveLength(2);
  });

  it('adds a repository once, and tells the listeners only when the list changes', async () => {
    await repository('app');
    const repos = createRepositories(store, space);
    const listener = vi.fn();
    repos.subscribe(listener);
    await repos.add('app');
    await repos.add('./app/');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(await repos.load()).toEqual([{ path: 'app', name: 'app' }]);
  });

  it('forgets folders that are gone or no longer repositories', async () => {
    await repository('gone');
    await repository('plain');
    await repository('kept');
    const repos = createRepositories(store, space);
    for (const path of ['gone', 'plain', 'kept']) await repos.add(path);
    await space.delete('gone');
    await space.delete('plain/.git');
    expect(await repos.load()).toEqual([{ path: 'kept', name: 'kept' }]);
    expect(JSON.parse(store.data.get('pepino.repositories') ?? '')).toEqual(['kept']);
  });

  it('survives a corrupt store', async () => {
    store.data.set('pepino.repositories', '{nope');
    expect(await createRepositories(store, space).load()).toEqual([]);
  });
});
