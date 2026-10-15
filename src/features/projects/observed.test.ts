import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryBackend } from './memoryBackend';
import { type FsEvents, observeProjectSpace } from './observed';
import { createProjectSpace, type ProjectSpace } from './projectSpace';

let space: ProjectSpace;
let seen: Array<[keyof FsEvents, FsEvents[keyof FsEvents]]>;

beforeEach(async () => {
  const raw = createProjectSpace(createMemoryBackend(() => 1));
  await raw.ensureCreated();
  seen = [];
  space = observeProjectSpace(raw, (topic, payload) => seen.push([topic, payload]));
});

describe('observeProjectSpace', () => {
  it('announces every kind of change with normalized paths', async () => {
    await space.createDirectory('/app/');
    await space.createFile('app/a.ts');
    await space.writeTextFile('app//a.ts', 'x');
    await space.rename('app/a.ts', ' b.ts ');
    await space.createDirectory('app/lib');
    await space.move('app/b.ts', 'app/lib');
    await space.copy('app/lib', '');
    await space.delete('lib');

    expect(seen).toEqual([
      ['fs.created', { path: 'app' }],
      ['fs.created', { path: 'app/a.ts' }],
      ['fs.written', { path: 'app/a.ts' }],
      ['fs.moved', { from: 'app/a.ts', to: 'app/b.ts' }],
      ['fs.created', { path: 'app/lib' }],
      ['fs.moved', { from: 'app/b.ts', to: 'app/lib/b.ts' }],
      ['fs.created', { path: 'lib' }],
      ['fs.deleted', { path: 'lib' }],
    ]);
  });

  it('stays quiet when a change fails or changes nothing', async () => {
    await space.createFile('a');
    seen = [];
    await expect(space.createFile('a')).rejects.toBeDefined();
    await space.rename('a', 'a');
    expect(seen).toEqual([]);
  });

  it('passes reads straight through', async () => {
    await space.writeTextFile('n.md', 'hola');
    seen = [];
    expect(await space.readTextFile('n.md')).toBe('hola');
    expect((await space.listDirectory('')).map((e) => e.name)).toEqual(['n.md']);
    expect(seen).toEqual([]);
  });
});
