import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryBackend } from '../projects/memoryBackend';
import { createProjectSpace, type ProjectSpace } from '../projects/projectSpace';
import { createMemoryGitEngine, type GitEngine } from './engine';

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
