import { beforeEach, describe, expect, it } from 'vitest';
import type { ProjectSpaceErrorCode } from './errors';
import { createMemoryBackend } from './memoryBackend';
import { createProjectSpace, type ProjectSpace } from './projectSpace';

let backend: ReturnType<typeof createMemoryBackend>;
let space: ProjectSpace;

const names = async (path = '') => (await space.listDirectory(path)).map((e) => e.path).sort();
const fails = (promise: Promise<unknown>, code: ProjectSpaceErrorCode) =>
  expect(promise).rejects.toMatchObject({ name: 'ProjectSpaceError', code });

beforeEach(async () => {
  backend = createMemoryBackend(() => 1000);
  space = createProjectSpace(backend);
  await space.ensureCreated();
});

describe('ensureCreated', () => {
  it('creates the root once and is idempotent', async () => {
    await space.ensureCreated();
    expect(await names()).toEqual([]);
  });
});

describe('listDirectory', () => {
  it('returns direct children with root-relative paths', async () => {
    await space.createDirectory('src');
    await space.createFile('src/main.ts');
    await space.createFile('README.md');
    expect(await names()).toEqual(['README.md', 'src']);
    expect(await space.listDirectory('src')).toEqual([
      { name: 'main.ts', path: 'src/main.ts', isDirectory: false, sizeBytes: 0, modifiedMillis: 1000 },
    ]);
  });

  it('fails for files, missing paths and escapes', async () => {
    await space.createFile('a.txt');
    await fails(space.listDirectory('a.txt'), 'NotADirectory');
    await fails(space.listDirectory('missing'), 'NotFound');
    await fails(space.listDirectory('../'), 'EscapesRoot');
  });
});

describe('create', () => {
  it('rejects existing entries, invalid names and missing parents', async () => {
    await space.createFile('a');
    await fails(space.createFile('a'), 'AlreadyExists');
    await fails(space.createDirectory('a'), 'AlreadyExists');
    await fails(space.createFile('missing/a'), 'NotFound');
    await fails(space.createFile(''), 'InvalidName');
    await fails(space.createFile('../outside'), 'EscapesRoot');
  });
});

describe('rename', () => {
  it('renames in place, trimming the new name', async () => {
    await space.createDirectory('dir');
    await space.createFile('dir/old.txt');
    await space.rename('dir/old.txt', '  new.txt ');
    expect(await names('dir')).toEqual(['dir/new.txt']);
  });

  it('carries directory contents along', async () => {
    await space.createDirectory('old');
    await space.createFile('old/inner.txt');
    await space.rename('old', 'new');
    expect(await names('new')).toEqual(['new/inner.txt']);
  });

  it('is a no-op for the same name', async () => {
    await space.createFile('a');
    await space.rename('a', 'a');
    expect(await names()).toEqual(['a']);
  });

  it('rejects clashes, invalid names, the root and missing sources', async () => {
    await space.createFile('a');
    await space.createFile('b');
    await fails(space.rename('a', 'b'), 'AlreadyExists');
    await fails(space.rename('a', '../b'), 'InvalidName');
    await fails(space.rename('', 'x'), 'InvalidName');
    await fails(space.rename('missing', 'x'), 'NotFound');
  });
});

describe('move', () => {
  beforeEach(async () => {
    await space.createDirectory('src');
    await space.createFile('src/a.txt');
    await space.createDirectory('dest');
  });

  it('moves into the destination keeping the name', async () => {
    await space.move('src', 'dest');
    expect(await names()).toEqual(['dest']);
    expect(await names('dest/src')).toEqual(['dest/src/a.txt']);
  });

  it('refuses to move a folder into itself or its own descendant', async () => {
    await space.createDirectory('src/inner');
    await fails(space.move('src', 'src'), 'IntoItself');
    await fails(space.move('src', 'src/inner'), 'IntoItself');
  });

  it('refuses clashes and same-folder moves', async () => {
    await space.createFile('dest/a.txt');
    await fails(space.move('src/a.txt', 'dest'), 'AlreadyExists');
    await fails(space.move('src/a.txt', 'src'), 'AlreadyExists');
  });

  it('requires a directory destination and never touches the root', async () => {
    await fails(space.move('src', 'src/a.txt'), 'NotADirectory');
    await fails(space.move('', 'dest'), 'InvalidName');
    await fails(space.move('src', '..'), 'EscapesRoot');
  });
});

describe('copy', () => {
  it('copies recursively and keeps the source', async () => {
    await space.createDirectory('src');
    await space.createDirectory('src/nested');
    await space.createFile('src/nested/a.txt');
    await space.createDirectory('dest');
    await space.copy('src', 'dest');
    expect(await names('src/nested')).toEqual(['src/nested/a.txt']);
    expect(await names('dest/src/nested')).toEqual(['dest/src/nested/a.txt']);
  });

  it('refuses to copy a folder into itself', async () => {
    await space.createDirectory('src');
    await fails(space.copy('src', 'src'), 'IntoItself');
  });
});

describe('delete', () => {
  it('deletes recursively', async () => {
    await space.createDirectory('dir');
    await space.createFile('dir/a.txt');
    await space.delete('dir');
    expect(await names()).toEqual([]);
    expect(backend.nodes.size).toBe(1);
  });

  it('never deletes the root or anything outside it', async () => {
    await fails(space.delete(''), 'InvalidName');
    await fails(space.delete('/'), 'InvalidName');
    await fails(space.delete('../x'), 'EscapesRoot');
    await fails(space.delete('missing'), 'NotFound');
  });
});

describe('text files', () => {
  it('writes, overwrites and reads back UTF-8 text', async () => {
    await space.writeTextFile('notes.md', '# hola');
    await space.writeTextFile('notes.md', '# adiós ✓');
    expect(await space.readTextFile('notes.md')).toBe('# adiós ✓');
    expect((await space.listDirectory('')).find((e) => e.name === 'notes.md')?.sizeBytes).toBe(12);
  });

  it('needs an existing parent folder and a valid name', async () => {
    await fails(space.writeTextFile('missing/a.txt', ''), 'NotFound');
    await fails(space.writeTextFile('../a.txt', ''), 'EscapesRoot');
    await fails(space.writeTextFile('', ''), 'InvalidName');
  });

  it('refuses folders on both ends', async () => {
    await space.createDirectory('dir');
    await fails(space.writeTextFile('dir', 'x'), 'IsADirectory');
    await fails(space.readTextFile('dir'), 'IsADirectory');
    await fails(space.readTextFile('missing'), 'NotFound');
  });
});

describe('backend failures', () => {
  it('are wrapped as Io errors', async () => {
    backend.writeText = async () => {
      throw new Error('disk full');
    };
    await fails(space.createFile('a'), 'Io');
  });
});
