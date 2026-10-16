import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryBackend } from '../projects/memoryBackend';
import { createProjectSpace, type ProjectSpace } from '../projects/projectSpace';
import { createMemoryGitEngine, GitError, type GitEngine } from './engine';

let space: ProjectSpace;
let git: GitEngine;

beforeEach(async () => {
  space = createProjectSpace(createMemoryBackend(() => 1));
  await space.ensureCreated();
  await space.createDirectory('app');
  git = createMemoryGitEngine(space);
});

describe('memory git engine', () => {
  it('initializes a folder on main, with no commits', async () => {
    expect(await git.isRepository('app')).toBe(false);
    expect(await git.info('app')).toBeNull();
    expect(await git.init('app')).toEqual({ branch: 'main', hasCommits: false });
    expect(await git.isRepository('app')).toBe(true);
    expect(await space.readTextFile('app/.git/HEAD')).toBe('ref: refs/heads/main\n');
  });

  it('leaves an existing repository as it is', async () => {
    await git.init('app');
    await space.writeTextFile('app/.git/HEAD', 'ref: refs/heads/trunk\n');
    const write = vi.spyOn(space, 'writeTextFile');
    expect(await git.init('app')).toEqual({ branch: 'trunk', hasCommits: false });
    expect(write).not.toHaveBeenCalled();
  });

  it('refuses the space root and missing folders', async () => {
    await expect(git.init('')).rejects.toMatchObject({ code: 'InvalidName' });
    await expect(git.init('missing')).rejects.toMatchObject({ code: 'NotFound' });
  });
});

describe('memory git engine: changes and commits', () => {
  beforeEach(async () => {
    await git.init('app');
    await git.setIdentity({ name: 'Pepino', email: 'me@pepino.dev' });
    await space.writeTextFile('app/a.txt', 'a');
    await space.createDirectory('app/src');
    await space.writeTextFile('app/src/b.ts', 'b');
    await space.createDirectory('app/.pepino');
    await space.writeTextFile('app/.pepino/snap', 'x');
  });

  it('lists new files, without git or Pepino folders', async () => {
    expect(await git.status('app')).toEqual([
      { path: 'a.txt', kind: 'new' },
      { path: 'src/b.ts', kind: 'new' },
    ]);
  });

  it('commits only the chosen files, then sees modified and deleted ones', async () => {
    const result = await git.commit('app', { message: 'Add a\n\nmore', paths: ['a.txt'] });
    expect(result.summary).toBe('Add a');
    expect(result.id).toHaveLength(7);
    expect(await git.info('app')).toEqual({ branch: 'main', hasCommits: true });
    expect(await git.status('app')).toEqual([{ path: 'src/b.ts', kind: 'new' }]);

    await space.writeTextFile('app/a.txt', 'changed');
    await git.commit('app', { message: 'b', paths: ['src/b.ts'] });
    await space.delete('app/src/b.ts');
    expect(await git.status('app')).toEqual([
      { path: 'a.txt', kind: 'modified' },
      { path: 'src/b.ts', kind: 'deleted' },
    ]);
  });

  it('refuses commits with no identity, no files, no summary or no changes', async () => {
    await expect(git.commit('app', { message: 'x', paths: [] })).rejects.toThrow('Choose at least one file');
    await expect(git.commit('app', { message: '  ', paths: ['a.txt'] })).rejects.toThrow('summary');
    await git.commit('app', { message: 'a', paths: ['a.txt'] });
    await expect(git.commit('app', { message: 'again', paths: ['a.txt'] })).rejects.toThrow('no changes');
    const fresh = createMemoryGitEngine(space);
    await expect(fresh.commit('app', { message: 'x', paths: ['src/b.ts'] })).rejects.toThrow('name and email');
  });
});

describe('memory git engine: branches', () => {
  beforeEach(async () => {
    await git.init('app');
    await git.setIdentity({ name: 'Pepino', email: 'me@pepino.dev' });
    await space.writeTextFile('app/a.txt', 'main');
  });

  it('cannot branch before the first commit', async () => {
    expect(await git.branches('app')).toEqual([{ name: 'main', current: true }]);
    await expect(git.createBranch('app', 'feature')).rejects.toThrow('first commit');
  });

  it('creates, switches (rewriting files) and lists branches', async () => {
    await git.commit('app', { message: 'first', paths: ['a.txt'] });
    expect(await git.createBranch('app', 'feature')).toEqual({ branch: 'feature', hasCommits: true });
    await space.writeTextFile('app/a.txt', 'feature');
    await space.writeTextFile('app/b.txt', 'only here');
    await git.commit('app', { message: 'work', paths: ['a.txt', 'b.txt'] });

    expect(await git.checkout('app', 'main')).toEqual({ branch: 'main', hasCommits: true });
    expect(await space.readTextFile('app/a.txt')).toBe('main');
    await expect(space.readTextFile('app/b.txt')).rejects.toMatchObject({ code: 'NotFound' });
    expect(await git.branches('app')).toEqual([
      { name: 'feature', current: false },
      { name: 'main', current: true },
    ]);
  });

  it('refuses to overwrite uncommitted changes, and deletes merged branches only unless forced', async () => {
    await git.commit('app', { message: 'first', paths: ['a.txt'] });
    await git.createBranch('app', 'feature');
    await space.writeTextFile('app/a.txt', 'feature');
    await git.commit('app', { message: 'work', paths: ['a.txt'] });
    await space.writeTextFile('app/a.txt', 'uncommitted');

    await expect(git.checkout('app', 'main')).rejects.toMatchObject({ code: 'CONFLICT', paths: ['a.txt'] });
    expect(await space.readTextFile('app/a.txt')).toBe('uncommitted');

    await git.commit('app', { message: 'more', paths: ['a.txt'] });
    await git.checkout('app', 'main');
    await expect(git.deleteBranch('app', 'main')).rejects.toThrow('Switch to another branch');
    await expect(git.deleteBranch('app', 'feature')).rejects.toBeInstanceOf(GitError);
    await git.deleteBranch('app', 'feature', { force: true });
    expect(await git.branches('app')).toEqual([{ name: 'main', current: true }]);
  });
});
