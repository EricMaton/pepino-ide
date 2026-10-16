import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryBackend } from './memoryBackend';
import { createProjectSpace, type ProjectSpace } from './projectSpace';
import { canBeProject, findRepositories, isRepository, isReservedName, readProject } from './projects';

let space: ProjectSpace;

beforeEach(async () => {
  space = createProjectSpace(createMemoryBackend(() => 1000));
  await space.ensureCreated();
});

describe('readProject', () => {
  it('opens any folder, at any depth', async () => {
    await space.createDirectory('plain');
    await space.createDirectory('plain/packages');
    expect(await readProject(space, 'plain')).toEqual({ path: 'plain', name: 'plain' });
    expect(await readProject(space, '/plain/packages/')).toEqual({ path: 'plain/packages', name: 'packages' });
  });

  it('returns null for the space root, files and missing folders', async () => {
    await space.writeTextFile('README.md', '');
    expect(await readProject(space, '')).toBeNull();
    expect(await readProject(space, 'README.md')).toBeNull();
    expect(await readProject(space, 'missing')).toBeNull();
  });
});

describe('repositories', () => {
  beforeEach(async () => {
    for (const dir of ['app', 'app/.git', 'app/sub', 'app/sub/.git', 'group', 'group/lib', 'group/lib/.git', 'plain']) {
      await space.createDirectory(dir);
    }
    await space.createDirectory('group/deep');
    await space.createDirectory('group/deep/repo');
    await space.createDirectory('group/deep/repo/.git');
  });

  it('knows whether a folder is a repository', async () => {
    expect(await isRepository(space, 'app')).toBe(true);
    expect(await isRepository(space, 'plain')).toBe(false);
    expect(await isRepository(space, 'missing')).toBe(false);
  });

  it('finds top-level repositories and the ones one level down, not deeper', async () => {
    expect((await findRepositories(space)).map((repo) => repo.path)).toEqual(['app', 'group/lib']);
  });
});

describe('helpers', () => {
  it('knows which paths can be projects and which names are reserved', () => {
    expect(canBeProject('app')).toBe(true);
    expect(canBeProject('app/src')).toBe(true);
    expect(canBeProject('/')).toBe(false);
    expect(canBeProject('')).toBe(false);
    expect(isReservedName(' .pepino ')).toBe(true);
    expect(isReservedName('.pepinos')).toBe(false);
  });
});
