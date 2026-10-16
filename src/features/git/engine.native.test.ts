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
}));

vi.mock('@capacitor/core', () => ({ registerPlugin: () => plugin }));

let git: GitEngine;
const announce = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  git = createNativeGitEngine(announce);
});

describe('native git engine', () => {
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
