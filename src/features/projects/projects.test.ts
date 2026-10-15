import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryBackend } from './memoryBackend';
import { createProjectSpace, type ProjectSpace } from './projectSpace';
import {
  canBeProject,
  createProject,
  isReservedName,
  listProjects,
  MARKER_FILE,
  markAsProject,
  readProject,
} from './projects';

let space: ProjectSpace;
const now = () => 42;

beforeEach(async () => {
  space = createProjectSpace(createMemoryBackend(() => 1000));
  await space.ensureCreated();
});

describe('createProject', () => {
  it('creates a marked top-level folder named after the project', async () => {
    const project = await createProject(space, '  pepino-ide ', now);
    expect(project).toEqual({ path: 'pepino-ide', name: 'pepino-ide', createdMillis: 42 });
    expect(JSON.parse(await space.readTextFile(`pepino-ide/${MARKER_FILE}`))).toEqual({
      version: 1,
      createdMillis: 42,
    });
  });

  it('rejects existing folders and reserved names', async () => {
    await space.createDirectory('taken');
    await expect(createProject(space, 'taken')).rejects.toMatchObject({ code: 'AlreadyExists' });
    await expect(createProject(space, '.pepino')).rejects.toMatchObject({ code: 'InvalidName' });
  });
});

describe('markAsProject', () => {
  it('marks an existing folder without touching its files', async () => {
    await space.createDirectory('legacy');
    await space.writeTextFile('legacy/main.kt', 'fun main() {}');
    const project = await markAsProject(space, 'legacy', now);
    expect(project.name).toBe('legacy');
    expect(await space.readTextFile('legacy/main.kt')).toBe('fun main() {}');
  });

  it('is idempotent and keeps the original creation time', async () => {
    await space.createDirectory('app');
    await markAsProject(space, 'app', () => 1);
    expect((await markAsProject(space, 'app', () => 2)).createdMillis).toBe(1);
  });

  it('only accepts top-level folders', async () => {
    await space.createDirectory('outer');
    await space.createDirectory('outer/inner');
    await expect(markAsProject(space, 'outer/inner')).rejects.toMatchObject({ code: 'InvalidName' });
    await expect(markAsProject(space, '')).rejects.toMatchObject({ code: 'InvalidName' });
  });
});

describe('readProject', () => {
  it('returns null for plain folders and nested paths', async () => {
    await space.createDirectory('plain');
    expect(await readProject(space, 'plain')).toBeNull();
    expect(await readProject(space, 'plain/deeper')).toBeNull();
  });

  it('follows the folder when it is renamed', async () => {
    await createProject(space, 'old', now);
    await space.rename('old', 'new');
    expect(await readProject(space, 'new')).toMatchObject({ name: 'new', createdMillis: 42 });
  });

  it('still recognizes a project whose marker is damaged', async () => {
    await createProject(space, 'broken', now);
    await space.writeTextFile(`broken/${MARKER_FILE}`, '{not json');
    expect(await readProject(space, 'broken')).toEqual({ path: 'broken', name: 'broken', createdMillis: 0 });
  });
});

describe('listProjects', () => {
  it('lists only marked top-level folders', async () => {
    await createProject(space, 'a', now);
    await createProject(space, 'b', now);
    await space.createDirectory('plain');
    await space.writeTextFile('README.md', '');
    expect((await listProjects(space)).map((p) => p.name).sort()).toEqual(['a', 'b']);
  });
});

describe('helpers', () => {
  it('knows which paths can be projects and which names are reserved', () => {
    expect(canBeProject('app')).toBe(true);
    expect(canBeProject('/app/')).toBe(true);
    expect(canBeProject('app/src')).toBe(false);
    expect(canBeProject('')).toBe(false);
    expect(isReservedName(' .pepino ')).toBe(true);
    expect(isReservedName('.pepinos')).toBe(false);
  });
});
