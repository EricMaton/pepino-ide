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
  it('clones a made-up repository with progress, into a new or empty folder only', async () => {
    const quick = createMemoryGitEngine(space, { cloneStepMs: 0 });
    const tasks = new Set<string>();
    const info = await quick.clone('hello', 'https://github.com/octocat/hello.git', ({ task }) => tasks.add(task));

    expect(info).toEqual({ branch: 'main', hasCommits: true });
    expect([...tasks]).toEqual(['Receiving objects', 'Resolving deltas', 'Checking out files']);
    expect(await space.readTextFile('hello/README.md')).toContain('# hello');
    expect(await quick.status('hello')).toEqual([]);
    expect((await quick.log('hello')).map((entry) => entry.author)).toEqual(['octocat']);

    await space.createFile('app/notes.txt');
    await expect(quick.clone('app', 'https://github.com/octocat/hello.git')).rejects.toThrow(/not empty/);
  });

  it('lists GitHub’s other branches after a clone, and switching makes the local one', async () => {
    const quick = createMemoryGitEngine(space, { cloneStepMs: 0 });
    await quick.clone('hello', 'https://github.com/octocat/hello.git');
    expect(await quick.branches('hello')).toEqual([
      { name: 'main', current: true },
      { name: 'develop', current: false, remote: true },
    ]);

    expect(await quick.checkout('hello', 'develop')).toEqual({ branch: 'develop', hasCommits: true });
    expect(await space.readTextFile('hello/CHANGELOG.md')).toContain('Work in progress');
    expect((await quick.log('hello')).map((entry) => entry.summary)).toEqual(['Start the changelog', 'Initial commit']);
    expect(await quick.branches('hello')).toEqual([
      { name: 'develop', current: true },
      { name: 'main', current: false },
    ]);
    expect(await quick.status('hello')).toEqual([]);
  });

  it('a cancelled clone writes nothing', async () => {
    const slow = createMemoryGitEngine(space, { cloneStepMs: 5 });
    const cloning = slow.clone('hello', 'https://github.com/octocat/hello.git', () => void slow.cancelRemote());
    await expect(cloning).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(await space.listDirectory('').then((entries) => entries.map((entry) => entry.name))).not.toContain('hello');
  });

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

describe('memory git engine: diffs and picked lines', () => {
  beforeEach(async () => {
    await git.init('app');
    await git.setIdentity({ name: 'Pepino', email: 'me@pepino.dev' });
    await space.writeTextFile('app/a.txt', 'one\ntwo\nthree\n');
    await git.commit('app', { message: 'first', paths: ['a.txt'] });
  });

  it('diffs the file on disk against the last commit', async () => {
    await space.writeTextFile('app/a.txt', 'one\n2\nthree\n');
    const diff = await git.diff('app', 'a.txt');
    expect(diff.binary).toBe(false);
    expect(diff.hunks[0].lines.map((line) => line.text)).toEqual(['one', 'two', '2', 'three']);
    expect((await git.diff('app', 'a.txt')).version).toBe(diff.version);
    await expect(git.diff('app', '../outside.txt')).rejects.toMatchObject({ code: 'EscapesRoot' });
  });

  it('commits without the lines left out, and refuses lines picked on an older version', async () => {
    await space.writeTextFile('app/a.txt', 'one\n2\nthree\nfour\n');
    const { version } = await git.diff('app', 'a.txt');
    await git.commit('app', { message: 'part', paths: ['a.txt'], excluded: { 'a.txt': { version, lines: [0, 2] } } });
    // "two" stayed in the commit, "four" stayed out
    const diff = await git.diff('app', 'a.txt');
    expect(
      diff.hunks.flatMap((hunk) => hunk.lines.filter((line) => line.index !== null).map((line) => line.text)),
    ).toEqual(['two', 'four']);

    await space.writeTextFile('app/a.txt', 'changed again\n');
    await expect(
      git.commit('app', {
        message: 'late',
        paths: ['a.txt'],
        excluded: { 'a.txt': { version: diff.version, lines: [0] } },
      }),
    ).rejects.toMatchObject({ code: 'STALE', paths: ['a.txt'] });
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

describe('memory git engine: history', () => {
  beforeEach(async () => {
    await git.init('app');
    await git.setIdentity({ name: 'Pepino', email: 'me@pepino.dev' });
  });

  it('lists the commits newest first, in pages, per branch', async () => {
    expect(await git.log('app')).toEqual([]);
    await space.writeTextFile('app/a.txt', '1\n');
    const first = await git.commit('app', { message: 'First', paths: ['a.txt'] });
    await space.writeTextFile('app/a.txt', '2\n');
    await git.commit('app', { message: 'Second\n\nWhy.\nIn two lines.', paths: ['a.txt'] });

    const log = await git.log('app');
    expect(log.map((entry) => entry.summary)).toEqual(['Second', 'First']);
    expect(log[0]).toMatchObject({ description: 'Why.\nIn two lines.', author: 'Pepino', email: 'me@pepino.dev' });
    expect(log[0].id).toHaveLength(40);
    expect(log[1].id.startsWith(first.id)).toBe(true);
    expect((await git.log('app', { skip: 1, limit: 1 })).map((entry) => entry.summary)).toEqual(['First']);

    await git.createBranch('app', 'feature');
    await space.writeTextFile('app/a.txt', '3\n');
    await git.commit('app', { message: 'On feature', paths: ['a.txt'] });
    expect((await git.log('app')).map((entry) => entry.summary)).toEqual(['On feature', 'Second', 'First']);
    await git.checkout('app', 'main');
    expect((await git.log('app')).map((entry) => entry.summary)).toEqual(['Second', 'First']);
  });

  it('shows what a commit changed against its parent', async () => {
    await space.writeTextFile('app/keep.txt', 'one\ntwo\n');
    await space.writeTextFile('app/gone.txt', 'bye\n');
    await git.commit('app', { message: 'First', paths: ['keep.txt', 'gone.txt'] });
    await space.writeTextFile('app/keep.txt', 'one\n2\n');
    await space.delete('app/gone.txt');
    await space.writeTextFile('app/new.txt', 'hi\n');
    await git.commit('app', { message: 'Second', paths: ['keep.txt', 'gone.txt', 'new.txt'] });
    const [second, first] = await git.log('app');

    expect(await git.commitChanges('app', first.id)).toEqual([
      { path: 'gone.txt', kind: 'new' },
      { path: 'keep.txt', kind: 'new' },
    ]);
    expect(await git.commitChanges('app', second.id.slice(0, 7))).toEqual([
      { path: 'gone.txt', kind: 'deleted' },
      { path: 'keep.txt', kind: 'modified' },
      { path: 'new.txt', kind: 'new' },
    ]);
    const lines = (await git.commitDiff('app', second.id, 'keep.txt')).hunks[0].lines;
    expect(lines.map((line) => `${line.kind}:${line.text}`)).toEqual(['context:one', 'removed:two', 'added:2']);
    await expect(git.commitChanges('app', 'nope')).rejects.toThrow('No commit');
  });
});

describe('memory git engine: snapshots', () => {
  beforeEach(async () => {
    await git.init('app');
    await git.setIdentity({ name: 'Pepino', email: 'me@pepino.dev' });
  });

  it('records the files without touching history or changes, once per state', async () => {
    await space.writeTextFile('app/a.txt', 'v1\n');
    const changes = await git.status('app');
    const first = await git.snapshot('app', 'Before editing a.txt');
    expect(await git.snapshot('app', 'Again')).toBe(first);
    expect(await git.status('app')).toEqual(changes);
    expect(await git.log('app')).toEqual([]);
    expect(await git.snapshotFile('app', first, 'a.txt')).toBe('v1\n');
    expect(await git.snapshotFile('app', first, 'missing.txt')).toBeNull();
  });

  it('lists each version of a file once, newest first', async () => {
    await space.writeTextFile('app/a.txt', 'v1\n');
    await git.snapshot('app', 'one');
    await space.writeTextFile('app/b.txt', 'other\n');
    await git.snapshot('app', 'b changed');
    await space.writeTextFile('app/a.txt', 'v2\n');
    await git.snapshot('app', 'three');
    const versions = await git.snapshotVersions('app', 'a.txt');
    expect(versions.map((version) => version.reason)).toEqual(['three', 'b changed']);
    expect(await git.snapshotFile('app', versions[1].id, 'a.txt')).toBe('v1\n');
  });

  it('takes one before switching branch', async () => {
    await space.writeTextFile('app/a.txt', 'main\n');
    await git.commit('app', { message: 'first', paths: ['a.txt'] });
    await git.createBranch('app', 'feature');
    await space.writeTextFile('app/notes.txt', 'uncommitted\n');
    await git.checkout('app', 'main');
    const [version] = await git.snapshotVersions('app', 'notes.txt');
    expect(version.reason).toBe('Before switching to main');
  });
});

describe('memory git engine: discarding (#138)', () => {
  beforeEach(async () => {
    await git.init('app');
    await git.setIdentity({ name: 'Pepino', email: 'me@pepino.dev' });
    await space.writeTextFile('app/a.txt', 'one\ntwo\nthree\n');
    await space.writeTextFile('app/gone.txt', 'bye\n');
    await git.commit('app', { message: 'first', paths: ['a.txt', 'gone.txt'] });
  });

  it('puts files back as committed, deletes new ones, and keeps a snapshot first', async () => {
    await space.writeTextFile('app/a.txt', 'one\nmine\nthree\n');
    await space.delete('app/gone.txt');
    await space.writeTextFile('app/new.txt', 'fresh\n');

    await git.discard('app', { paths: ['a.txt', 'gone.txt', 'new.txt'] });

    expect(await git.status('app')).toEqual([]);
    expect(await space.readTextFile('app/a.txt')).toBe('one\ntwo\nthree\n');
    expect(await space.readTextFile('app/gone.txt')).toBe('bye\n');
    await expect(space.readTextFile('app/new.txt')).rejects.toThrow();
    const [version] = await git.snapshotVersions('app', 'a.txt');
    expect(version.reason).toBe('Before discarding changes to a.txt and 2 more');
    expect(await git.snapshotFile('app', version.id, 'a.txt')).toBe('one\nmine\nthree\n');
  });

  it('discards only the picked lines, and nothing when they were picked on an older version', async () => {
    await space.writeTextFile('app/a.txt', 'one\nTWO\nthree\nfour\n');
    const { version } = await git.diff('app', 'a.txt');
    // lines 0 and 1: "two" removed and "TWO" added; 2: "four" added
    await git.discard('app', { paths: ['a.txt'], lines: { 'a.txt': { version, lines: [2] } } });
    expect(await space.readTextFile('app/a.txt')).toBe('one\nTWO\nthree\n');

    await expect(
      git.discard('app', { paths: ['a.txt'], lines: { 'a.txt': { version, lines: [0, 1] } } }),
    ).rejects.toMatchObject({ code: 'STALE', paths: ['a.txt'] });
    expect(await space.readTextFile('app/a.txt')).toBe('one\nTWO\nthree\n');

    const fresh = await git.diff('app', 'a.txt');
    await git.discard('app', { paths: ['a.txt'], lines: { 'a.txt': { version: fresh.version, lines: [0, 1] } } });
    expect(await git.status('app')).toEqual([]);
  });
});

describe('memory git engine: stash (#139)', () => {
  beforeEach(async () => {
    await git.init('app');
    await git.setIdentity({ name: 'Pepino', email: 'me@pepino.dev' });
    await space.writeTextFile('app/a.txt', 'one\n');
    await space.writeTextFile('app/gone.txt', 'bye\n');
    await git.commit('app', { message: 'first', paths: ['a.txt', 'gone.txt'] });
  });

  it('sets the changes aside for the branch, and restores them', async () => {
    await space.writeTextFile('app/a.txt', 'mine\n');
    await space.delete('app/gone.txt');
    await space.writeTextFile('app/new.txt', 'fresh\n');
    expect(await git.stash('app')).toBeNull();

    const stash = await git.stashChanges('app');

    expect(stash.branch).toBe('main');
    expect(stash.files.map((file) => `${file.path}:${file.kind}`)).toEqual([
      'a.txt:modified',
      'gone.txt:deleted',
      'new.txt:new',
    ]);
    expect(await git.status('app')).toEqual([]);
    expect(await space.readTextFile('app/a.txt')).toBe('one\n');
    expect(await git.stash('app')).toMatchObject({ branch: 'main' });
    expect((await git.snapshotVersions('app', 'a.txt'))[0].reason).toBe('Before stashing changes on main');

    await git.restoreStash('app');

    expect(await space.readTextFile('app/a.txt')).toBe('mine\n');
    expect(await space.readTextFile('app/new.txt')).toBe('fresh\n');
    await expect(space.readTextFile('app/gone.txt')).rejects.toThrow();
    expect(await git.stash('app')).toBeNull();
  });

  it('keeps one stash per branch; restoring needs a branch without changes', async () => {
    await space.writeTextFile('app/a.txt', 'on main\n');
    await git.stashChanges('app');
    await git.createBranch('app', 'feature');
    expect(await git.stash('app')).toBeNull();
    await expect(git.stashChanges('app')).rejects.toThrow(/No changes/);

    await git.checkout('app', 'main');
    await space.writeTextFile('app/gone.txt', 'in the way\n');
    await expect(git.restoreStash('app')).rejects.toMatchObject({ code: 'CONFLICT', paths: ['gone.txt'] });

    await git.dropStash('app');
    expect(await git.stash('app')).toBeNull();
    await expect(git.dropStash('app')).rejects.toThrow(/No stashed changes/);
  });

  it('a stash that no longer fits the branch changes nothing and stays', async () => {
    await space.writeTextFile('app/a.txt', 'mine\n');
    await git.stashChanges('app');
    await space.writeTextFile('app/a.txt', 'committed meanwhile\n');
    await git.commit('app', { message: 'meanwhile', paths: ['a.txt'] });

    await expect(git.restoreStash('app')).rejects.toThrow(/conflict/);
    expect(await space.readTextFile('app/a.txt')).toBe('committed meanwhile\n');
    expect(await git.stash('app')).not.toBeNull();
  });
});
