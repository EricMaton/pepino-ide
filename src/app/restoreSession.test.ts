import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryBackend } from '../features/projects/memoryBackend';
import { createProjectSpace, type ProjectSpace } from '../features/projects/projectSpace';
import { restoreSession } from './restoreSession';
import { EMPTY_SESSION, type Session } from './session';

let space: ProjectSpace;

beforeEach(async () => {
  space = createProjectSpace(createMemoryBackend(() => 1));
  await space.ensureCreated();
  await space.createDirectory('app');
  await space.createDirectory('app/src');
  await space.writeTextFile('app/src/main.ts', 'x');
  await space.writeTextFile('notes.md', '');
});

const session = (patch: Partial<Session>): Session => ({ ...EMPTY_SESSION, ...patch });

describe('restoreSession', () => {
  it('restores the project, the explorer folder and editor positions', async () => {
    const restored = await restoreSession(
      space,
      session({
        project: 'app/src',
        inWorkspace: true,
        explorer: { '': ['', 'app'] },
        editors: { 'app/src/main.ts': { anchor: 1, head: 1, scrollTop: 40, savedMillis: 9 } },
      }),
    );
    expect(restored).toEqual({
      project: { path: 'app/src', name: 'src' },
      inWorkspace: true,
      stack: ['', 'app'],
      looseFile: null,
      editors: { 'app/src/main.ts': { anchor: 1, head: 1, scrollTop: 40 } },
    });
  });

  it('drops a project that was deleted, and goes back to the explorer', async () => {
    await space.delete('app');
    const restored = await restoreSession(space, session({ project: 'app', inWorkspace: true }));
    expect(restored).toMatchObject({ project: null, inWorkspace: false });
  });

  it('falls back to the root when a remembered folder is gone', async () => {
    await space.delete('app/src');
    expect((await restoreSession(space, session({ explorer: { '': ['', 'app', 'app/src'] } }))).stack).toBeNull();
  });

  it('rejects stacks that do not descend one folder at a time from the root', async () => {
    expect((await restoreSession(space, session({ explorer: { '': ['', 'app/src'] } }))).stack).toBeNull();
  });

  it('reopens a loose file over the explorer, keeping the project active', async () => {
    const restored = await restoreSession(space, session({ project: 'app', inWorkspace: true, looseFile: 'notes.md' }));
    expect(restored).toMatchObject({ project: { path: 'app' }, inWorkspace: false, looseFile: 'notes.md' });
  });

  it('does not reopen a loose file that is gone or now a folder', async () => {
    expect((await restoreSession(space, session({ looseFile: 'missing.md' }))).looseFile).toBeNull();
    expect((await restoreSession(space, session({ looseFile: 'app/src' }))).looseFile).toBeNull();
  });
});
