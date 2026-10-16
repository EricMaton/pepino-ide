import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryBackend } from '../projects/memoryBackend';
import { createProjectSpace, type ProjectSpace } from '../projects/projectSpace';
import { createMemoryGitEngine, type GitEngine } from './engine';
import { describeSync, syncAction } from './sync';

/*
 * Fetch, pull and push in the web stand-in (#33): what `npm run dev` shows.
 * The real thing is JGit, tested in GitSyncTest.
 */
let space: ProjectSpace;
let git: GitEngine;
const URL = 'https://github.com/octocat/hello.git';

beforeEach(async () => {
  space = createProjectSpace(createMemoryBackend(() => 1));
  await space.ensureCreated();
  git = createMemoryGitEngine(space, { cloneStepMs: 0 });
  await git.setIdentity({ name: 'Pepino', email: 'me@pepino.dev' });
  await git.clone('hello', URL);
});

const commit = async (file: string, text: string) => {
  await space.writeTextFile(`hello/${file}`, text);
  await git.commit('hello', { message: `Edit ${file}`, paths: [file] });
};

describe('memory git engine: sync', () => {
  it('a clone is up to date with GitHub; a repository made here has no GitHub', async () => {
    expect(await git.sync('hello')).toEqual({ remote: true, upstream: 'origin/main', ahead: 0, behind: 0 });
    await space.createDirectory('local');
    await git.init('local');
    expect(await git.sync('local')).toEqual({ remote: false, upstream: null, ahead: 0, behind: 0 });
    await expect(git.fetch('local')).rejects.toThrow(/not connected/);
  });

  it('fetch finds a teammate’s commit without touching files, and pull brings it', async () => {
    const tasks: string[] = [];
    expect(await git.fetch('hello', ({ task }) => tasks.push(task))).toMatchObject({ behind: 1, ahead: 0 });
    expect(tasks).toContain('Receiving objects');
    await expect(space.readTextFile('hello/NOTES.md')).rejects.toThrow();

    expect(await git.pull('hello')).toMatchObject({ behind: 0, ahead: 0 });
    expect(await space.readTextFile('hello/NOTES.md')).toContain('teammate');
    expect(await git.status('hello')).toEqual([]);
    expect((await git.log('hello'))[0].summary).toBe('Add notes');
  });

  it('push sends commits; a branch not on GitHub is published', async () => {
    await git.pull('hello'); // the teammate's commit first
    await commit('README.md', '# hello, edited\n');
    expect(await git.sync('hello')).toMatchObject({ ahead: 1 });
    expect(await git.push('hello')).toMatchObject({ ahead: 0, behind: 0 });

    await git.createBranch('hello', 'feature');
    await commit('feature.txt', 'wip\n');
    expect(await git.sync('hello')).toMatchObject({ upstream: null });
    expect(await git.push('hello')).toEqual({ remote: true, upstream: 'origin/feature', ahead: 0, behind: 0 });
  });

  it('push is rejected while GitHub has commits; pull merges, then push goes', async () => {
    await git.fetch('hello');
    await commit('README.md', '# hello, mine\n');
    await expect(git.push('hello')).rejects.toMatchObject({ code: 'REJECTED' });

    expect(await git.pull('hello')).toMatchObject({ behind: 0, ahead: 2 });
    expect(await space.readTextFile('hello/README.md')).toBe('# hello, mine\n');
    expect(await space.readTextFile('hello/NOTES.md')).toContain('teammate');
    expect((await git.log('hello'))[0].summary).toBe('Merge origin/main into main');
    expect(await git.push('hello')).toMatchObject({ ahead: 0 });
  });

  it('a pull that would conflict, or with changes in the way, changes nothing', async () => {
    await git.fetch('hello');
    await commit('NOTES.md', '# My own notes\n');
    await expect(git.pull('hello')).rejects.toMatchObject({ code: 'MERGE_CONFLICT', paths: ['NOTES.md'] });
    expect(await space.readTextFile('hello/NOTES.md')).toBe('# My own notes\n');
  });

  it('uncommitted changes to a file the pull writes are in the way', async () => {
    await git.fetch('hello');
    await space.writeTextFile('hello/NOTES.md', 'scribbles\n');
    await expect(git.pull('hello')).rejects.toMatchObject({ code: 'CONFLICT', paths: ['NOTES.md'] });
    expect(await space.readTextFile('hello/NOTES.md')).toBe('scribbles\n');
  });

  it('a cancelled pull changes nothing', async () => {
    const slow = createMemoryGitEngine(space, { cloneStepMs: 5 });
    await expect(slow.pull('hello', () => void slow.cancelRemote())).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(await slow.sync('hello')).toMatchObject({ behind: 0 });
  });
});

describe('the sync bar', () => {
  const state = (upstream: string | null, ahead: number, behind: number) => ({ remote: true, upstream, ahead, behind });

  it('offers one action: publish, then pull before push, else fetch', () => {
    expect(syncAction(state(null, 3, 0))).toBe('publish');
    expect(syncAction(state('origin/main', 2, 1))).toBe('pull');
    expect(syncAction(state('origin/main', 2, 0))).toBe('push');
    expect(syncAction(state('origin/main', 0, 0))).toBe('fetch');
  });

  it('says what it would do', () => {
    expect(describeSync(state(null, 0, 0), 'feature')).toEqual({
      title: 'Publish branch',
      detail: 'feature is not on GitHub yet',
    });
    expect(describeSync(state('origin/main', 2, 1), 'main').detail).toBe(
      '1 commit on GitHub to bring · 2 to push after',
    );
    expect(describeSync(state('origin/main', 3, 0), 'main').detail).toBe('3 commits to send to origin/main');
    expect(describeSync(state('origin/main', 0, 0), 'main').title).toBe('Fetch origin');
  });
});
