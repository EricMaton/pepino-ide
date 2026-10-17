import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeGitEngine, GitError, type GitEngine } from './engine';

/*
 * The TypeScript side of the native engine (#28): what it sends the `Git`
 * plugin, what it announces on the bus, and how plugin errors reach the UI.
 * JGit itself is tested in JUnit (GitOpsTest, CommitCrashTest).
 */
const plugin = vi.hoisted(() => ({
  isRepository: vi.fn(),
  init: vi.fn(),
  info: vi.fn(),
  status: vi.fn(),
  diff: vi.fn(),
  commit: vi.fn(),
  log: vi.fn(),
  commitChanges: vi.fn(),
  commitDiff: vi.fn(),
  snapshot: vi.fn(),
  snapshotVersions: vi.fn(),
  snapshotFile: vi.fn(),
  identity: vi.fn(),
  setIdentity: vi.fn(),
  branches: vi.fn(),
  createBranch: vi.fn(),
  checkout: vi.fn(),
  deleteBranch: vi.fn(),
  clone: vi.fn(),
  cancelRemote: vi.fn(),
  addListener: vi.fn(),
  sync: vi.fn(),
  syncCommits: vi.fn(),
  discard: vi.fn(),
  stash: vi.fn(),
  stashChanges: vi.fn(),
  restoreStash: vi.fn(),
  dropStash: vi.fn(),
  lastCommit: vi.fn(),
  undoCommit: vi.fn(),
  revert: vi.fn(),
  fetch: vi.fn(),
  pull: vi.fn(),
  push: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({ registerPlugin: () => plugin }));

let git: GitEngine;
const announce = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  git = createNativeGitEngine(announce);
});

describe('native git engine', () => {
  it('clones with progress, announces the folder and stops listening after', async () => {
    const remove = vi.fn();
    let tell: (progress: unknown) => void = () => undefined;
    plugin.addListener.mockImplementation(async (_event: string, listener: (progress: unknown) => void) => {
      tell = listener;
      return { remove };
    });
    plugin.clone.mockImplementation(async () => {
      tell({ task: 'Receiving objects', done: 5, total: 10 });
      return { branch: 'main', hasCommits: true };
    });
    const onProgress = vi.fn();

    expect(await git.clone('work/hello', 'https://github.com/octocat/hello.git', onProgress)).toEqual({
      branch: 'main',
      hasCommits: true,
    });
    expect(plugin.addListener).toHaveBeenCalledWith('remoteProgress', onProgress);
    expect(plugin.clone).toHaveBeenCalledWith({ path: 'work/hello', url: 'https://github.com/octocat/hello.git' });
    expect(onProgress).toHaveBeenCalledWith({ task: 'Receiving objects', done: 5, total: 10 });
    expect(announce).toHaveBeenCalledWith('fs.created', { path: 'work/hello' });
    expect(remove).toHaveBeenCalled();
  });

  it('pulls, announcing the files it rewrote, and follows the progress only while it lasts', async () => {
    const remove = vi.fn();
    plugin.addListener.mockResolvedValue({ remove });
    const state = { remote: true, upstream: 'origin/main', ahead: 0, behind: 0 };
    plugin.pull.mockResolvedValue({ state, written: ['src/a.ts'], removed: ['old.ts'] });

    expect(await git.pull('work/app', vi.fn())).toEqual(state);
    expect(plugin.pull).toHaveBeenCalledWith({ path: 'work/app' });
    expect(announce).toHaveBeenCalledWith('fs.written', { path: 'work/app/src/a.ts' });
    expect(announce).toHaveBeenCalledWith('fs.deleted', { path: 'work/app/old.ts' });
    expect(remove).toHaveBeenCalled();
  });

  it('fetch, push and sync go to the plugin; their refusals become GitErrors', async () => {
    const state = { remote: true, upstream: 'origin/main', ahead: 1, behind: 0 };
    plugin.sync.mockResolvedValue(state);
    plugin.fetch.mockResolvedValue(state);
    expect(await git.sync('app')).toEqual(state);
    expect(await git.fetch('app')).toEqual(state);
    plugin.syncCommits.mockResolvedValue({ toPull: [], toPush: [] });
    expect(await git.syncCommits('app')).toEqual({ toPull: [], toPush: [] });
    expect(plugin.syncCommits).toHaveBeenCalledWith({ path: 'app', limit: 100 });
    expect(plugin.addListener).not.toHaveBeenCalled(); // no progress asked for

    plugin.push.mockRejectedValueOnce({ code: 'REJECTED', message: 'pull first' });
    await expect(git.push('app')).rejects.toMatchObject({ code: 'REJECTED' });
    plugin.pull.mockRejectedValueOnce({ code: 'MERGE_CONFLICT', message: 'same lines', data: { paths: ['a.txt'] } });
    const conflict = await git.pull('app').catch((error: unknown) => error);
    expect(conflict).toBeInstanceOf(GitError);
    expect(conflict).toMatchObject({ code: 'MERGE_CONFLICT', paths: ['a.txt'] });
  });

  it('turns a failed clone into a GitError, still removing the listener', async () => {
    const remove = vi.fn();
    plugin.addListener.mockResolvedValue({ remove });
    for (const code of ['CANCELLED', 'UNAUTHORIZED', 'NETWORK'] as const) {
      plugin.clone.mockRejectedValueOnce({ code, message: 'nope' });
      await expect(git.clone('hello', 'https://github.com/a/hello.git', vi.fn())).rejects.toMatchObject({ code });
    }
    expect(remove).toHaveBeenCalledTimes(3);
    expect(announce).not.toHaveBeenCalled();
  });

  it('sends project paths resolved inside the space, and never the space root', async () => {
    plugin.info.mockResolvedValue({ info: { branch: 'main', hasCommits: true } });
    expect(await git.info('./app/')).toEqual({ branch: 'main', hasCommits: true });
    expect(plugin.info).toHaveBeenCalledWith({ path: 'app' });
    await expect(git.info('')).rejects.toMatchObject({ code: 'InvalidName' });
    await expect(git.status('app/../..')).rejects.toMatchObject({ code: 'EscapesRoot' });
    expect(plugin.status).not.toHaveBeenCalled();
  });

  it('announces a new .git, but not when the folder already was a repository', async () => {
    plugin.init.mockResolvedValue({ branch: 'main', hasCommits: false });
    plugin.isRepository.mockResolvedValueOnce({ repository: false });
    await git.init('app');
    expect(announce).toHaveBeenCalledWith('fs.created', { path: 'app/.git' });

    announce.mockClear();
    plugin.isRepository.mockResolvedValueOnce({ repository: true });
    await git.init('app');
    expect(announce).not.toHaveBeenCalled();
  });

  it('announces the files a branch switch rewrote or removed, inside the project', async () => {
    plugin.checkout.mockResolvedValue({
      info: { branch: 'feature', hasCommits: true },
      written: ['a.txt', 'src/b.ts'],
      removed: ['old.txt'],
    });
    expect(await git.checkout('work/app', 'feature')).toEqual({ branch: 'feature', hasCommits: true });
    expect(plugin.checkout).toHaveBeenCalledWith({ path: 'work/app', name: 'feature' });
    expect(announce.mock.calls).toEqual([
      ['fs.written', { path: 'work/app/a.txt' }],
      ['fs.written', { path: 'work/app/src/b.ts' }],
      ['fs.deleted', { path: 'work/app/old.txt' }],
    ]);
  });

  it('turns the errors the UI handles into GitErrors, with their files', async () => {
    plugin.checkout.mockRejectedValue({ code: 'CONFLICT', message: 'Commit a.txt first', data: { paths: ['a.txt'] } });
    const conflict = await git.checkout('app', 'main').catch((error: unknown) => error);
    expect(conflict).toBeInstanceOf(GitError);
    expect(conflict).toMatchObject({ code: 'CONFLICT', message: 'Commit a.txt first', paths: ['a.txt'] });
    expect(announce).not.toHaveBeenCalled();

    plugin.deleteBranch.mockRejectedValue({ code: 'NOT_MERGED', message: 'feature has commits' });
    await expect(git.deleteBranch('app', 'feature')).rejects.toMatchObject({ code: 'NOT_MERGED', paths: [] });
    expect(plugin.deleteBranch).toHaveBeenCalledWith({ path: 'app', name: 'feature', force: false });

    plugin.commit.mockRejectedValue({ code: 'STALE', message: 'a.txt changed', data: { paths: ['a.txt'] } });
    await expect(git.commit('app', { message: 'm', paths: ['a.txt'] })).rejects.toBeInstanceOf(GitError);

    // anything else reaches the UI as it is
    const other = new Error('disk full');
    plugin.commit.mockRejectedValue(other);
    await expect(git.commit('app', { message: 'm', paths: ['a.txt'] })).rejects.toBe(other);
  });

  it('sends commits with their files and picked lines, and pages through the history', async () => {
    plugin.commit.mockResolvedValue({ id: 'abc1234', summary: 'm' });
    const paths = ['a.txt'];
    await git.commit('app', { message: 'm', paths, excluded: { 'a.txt': { version: 'v', lines: [2] } } });
    expect(plugin.commit).toHaveBeenCalledWith({
      path: 'app',
      message: 'm',
      paths: ['a.txt'],
      excluded: { 'a.txt': { version: 'v', lines: [2] } },
      amend: false,
    });
    expect(plugin.commit.mock.calls[0][0].paths).not.toBe(paths);

    plugin.log.mockResolvedValue({ commits: [] });
    await git.log('app');
    await git.log('app', { skip: 50, limit: 10 });
    expect(plugin.log.mock.calls).toEqual([
      [{ path: 'app', skip: 0, limit: 50 }],
      [{ path: 'app', skip: 50, limit: 10 }],
    ]);
  });

  it('unwraps what the plugin returns', async () => {
    plugin.status.mockResolvedValue({ changes: [{ path: 'a.txt', kind: 'new' }] });
    plugin.branches.mockResolvedValue({ branches: [{ name: 'main', current: true }] });
    plugin.identity.mockResolvedValue({ identity: null });
    plugin.snapshot.mockResolvedValue({ id: 'snap' });
    plugin.snapshotFile.mockResolvedValue({ text: null });
    expect(await git.status('app')).toEqual([{ path: 'a.txt', kind: 'new' }]);
    expect(await git.branches('app')).toEqual([{ name: 'main', current: true }]);
    expect(await git.identity()).toBeNull();
    expect(await git.snapshot('app', 'Before editing a.txt')).toBe('snap');
    expect(plugin.snapshot).toHaveBeenCalledWith({ path: 'app', reason: 'Before editing a.txt' });
    expect(await git.snapshotFile('app', 'snap', 'gone.txt')).toBeNull();
  });
});

describe('native git engine: discard (#138)', () => {
  it('sends the files and picked lines, and announces what it wrote and removed', async () => {
    plugin.discard.mockResolvedValue({ written: ['a.txt'], removed: ['new.txt'] });
    const lines = { 'a.txt': { version: 'v1', lines: [2] } };

    await git.discard('work/app', { paths: ['a.txt', 'new.txt'], lines });

    expect(plugin.discard).toHaveBeenCalledWith({ path: 'work/app', paths: ['a.txt', 'new.txt'], lines });
    expect(announce).toHaveBeenCalledWith('fs.written', { path: 'work/app/a.txt' });
    expect(announce).toHaveBeenCalledWith('fs.deleted', { path: 'work/app/new.txt' });

    plugin.discard.mockRejectedValueOnce({ code: 'STALE', message: 'a.txt changed', data: { paths: ['a.txt'] } });
    await expect(git.discard('work/app', { paths: ['a.txt'], lines })).rejects.toMatchObject({
      code: 'STALE',
      paths: ['a.txt'],
    });
  });
});

describe('native git engine: stash (#139)', () => {
  it('stashes and restores through the plugin, announcing the files they touch', async () => {
    const stash = { branch: 'main', time: 1, files: [{ path: 'a.txt', kind: 'modified' }] };
    plugin.stash.mockResolvedValue({ stash: null });
    expect(await git.stash('work/app')).toBeNull();

    plugin.stashChanges.mockResolvedValue({ stash, written: ['a.txt'], removed: ['new.txt'] });
    expect(await git.stashChanges('work/app')).toEqual(stash);
    expect(announce).toHaveBeenCalledWith('fs.written', { path: 'work/app/a.txt' });
    expect(announce).toHaveBeenCalledWith('fs.deleted', { path: 'work/app/new.txt' });

    plugin.restoreStash.mockRejectedValueOnce({ code: 'CONFLICT', message: 'in the way', data: { paths: ['b.txt'] } });
    await expect(git.restoreStash('work/app')).rejects.toMatchObject({ code: 'CONFLICT', paths: ['b.txt'] });
    plugin.restoreStash.mockResolvedValue({ written: ['a.txt'], removed: [] });
    await git.restoreStash('work/app');
    expect(plugin.restoreStash).toHaveBeenLastCalledWith({ path: 'work/app' });
  });
});

describe('native git engine: undo (#140)', () => {
  it('reads the last commit and undoes it through the plugin; PUSHED as a GitError', async () => {
    const commit = { id: 'abc', summary: 'second', description: '', author: 'me', email: '', time: 1 };
    plugin.lastCommit.mockResolvedValue({ last: { commit, onGitHub: false, merge: false } });
    expect(await git.lastCommit('work/app')).toEqual({ commit, onGitHub: false, merge: false });

    plugin.undoCommit.mockResolvedValue({ commit });
    expect(await git.undoCommit('work/app')).toEqual(commit);
    expect(plugin.undoCommit).toHaveBeenLastCalledWith({ path: 'work/app' });

    plugin.undoCommit.mockRejectedValueOnce({ code: 'PUSHED', message: 'on GitHub' });
    await expect(git.undoCommit('work/app')).rejects.toMatchObject({ code: 'PUSHED' });
  });
});

describe('native git engine: revert (#142)', () => {
  it('reverts through the plugin, announcing the files; a clash as MERGE_CONFLICT', async () => {
    plugin.revert.mockResolvedValue({
      commit: { id: 'def', summary: 'Revert "x"' },
      written: ['a.txt'],
      removed: ['n.txt'],
    });
    expect(await git.revert('work/app', 'abc')).toEqual({ id: 'def', summary: 'Revert "x"' });
    expect(plugin.revert).toHaveBeenLastCalledWith({ path: 'work/app', commit: 'abc' });
    expect(announce).toHaveBeenCalledWith('fs.written', { path: 'work/app/a.txt' });
    expect(announce).toHaveBeenCalledWith('fs.deleted', { path: 'work/app/n.txt' });

    plugin.revert.mockRejectedValueOnce({ code: 'MERGE_CONFLICT', message: 'clash', data: { paths: ['a.txt'] } });
    await expect(git.revert('work/app', 'abc')).rejects.toMatchObject({ code: 'MERGE_CONFLICT', paths: ['a.txt'] });
  });
});
