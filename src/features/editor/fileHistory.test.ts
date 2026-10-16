import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryGitEngine, type GitEngine } from '../git/engine';
import { createMemoryBackend } from '../projects/memoryBackend';
import { createProjectSpace, type ProjectSpace } from '../projects/projectSpace';
import { createFileHistory, type FileHistory, repositoryOf } from './fileHistory';
import { listSnapshots } from './snapshots';

let space: ProjectSpace;
let git: GitEngine;
let history: FileHistory;

beforeEach(async () => {
  space = createProjectSpace(createMemoryBackend(() => 1));
  await space.ensureCreated();
  git = createMemoryGitEngine(space);
  history = createFileHistory(space, git);
  for (const dir of ['repo', 'repo/src', 'plain']) await space.createDirectory(dir);
  await git.init('repo');
});

describe('repositoryOf', () => {
  it('finds the nearest repository above a file', async () => {
    expect(await repositoryOf(space, 'repo/src/a.ts')).toBe('repo');
    expect(await repositoryOf(space, 'repo/a.ts')).toBe('repo');
    expect(await repositoryOf(space, 'plain/a.ts')).toBeNull();
    expect(await repositoryOf(space, 'loose.txt')).toBeNull();
  });
});

describe('createFileHistory', () => {
  it('keeps a file in a repository as a git snapshot, and reads it back', async () => {
    await space.writeTextFile('repo/src/a.ts', 'v1\n');
    await history.beforeOverwrite('repo/src/a.ts', 'v1\n');
    await space.writeTextFile('repo/src/a.ts', 'v2\n');

    const versions = await history.versions('repo/src/a.ts');
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ source: 'git', reason: 'Before editing src/a.ts' });
    expect(await history.read('repo/src/a.ts', versions[0])).toBe('v1\n');
    // no copy in .pepino for it
    expect(await listSnapshots(space, 'repo/src/a.ts')).toEqual([]);
  });

  it('keeps a file outside any repository as a copy', async () => {
    await space.writeTextFile('plain/a.ts', 'v1\n');
    await history.beforeOverwrite('plain/a.ts', 'v1\n');
    const [version] = await history.versions('plain/a.ts');
    expect(version.source).toBe('copy');
    expect(await history.read('plain/a.ts', version)).toBe('v1\n');
  });

  it('lists copies kept before the folder was a repository with the snapshots, newest first', async () => {
    await space.writeTextFile('plain/a.ts', 'old copy\n');
    await history.beforeOverwrite('plain/a.ts', 'old copy\n');
    await git.init('plain');
    await space.writeTextFile('plain/a.ts', 'in git\n');
    await history.beforeOverwrite('plain/a.ts', 'in git\n', 'Before restoring');
    const versions = await history.versions('plain/a.ts');
    expect(versions.map((version) => version.source)).toEqual(['git', 'copy']);
    expect(versions[0].reason).toBe('Before restoring');
  });
});
