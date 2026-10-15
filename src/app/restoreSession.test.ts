import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryBackend } from '../features/projects/memoryBackend';
import { createProject } from '../features/projects/projects';
import { createProjectSpace, type ProjectSpace } from '../features/projects/projectSpace';
import { restoreSession } from './restoreSession';
import { EMPTY_SESSION, type Session } from './session';

let space: ProjectSpace;

beforeEach(async () => {
  space = createProjectSpace(createMemoryBackend(() => 1));
  await space.ensureCreated();
  await createProject(space, 'app', () => 5);
  await space.createDirectory('app/src');
  await space.writeTextFile('app/src/main.ts', 'x');
});

const session = (patch: Partial<Session>): Session => ({ ...EMPTY_SESSION, ...patch });

describe('restoreSession', () => {
  it('restores project, folder, file and editor positions that still exist', async () => {
    const restored = await restoreSession(
      space,
      session({
        project: 'app',
        explorer: { app: ['app', 'app/src'] },
        openFile: 'app/src/main.ts',
        editors: { 'app/src/main.ts': { anchor: 1, head: 1, scrollTop: 40, savedMillis: 9 } },
      }),
    );
    expect(restored).toEqual({
      project: { path: 'app', name: 'app', createdMillis: 5 },
      stack: ['app', 'app/src'],
      openFile: 'app/src/main.ts',
      editors: { 'app/src/main.ts': { anchor: 1, head: 1, scrollTop: 40 } },
    });
  });

  it('drops a project that was deleted, and everything inside it', async () => {
    await space.delete('app');
    const restored = await restoreSession(
      space,
      session({ project: 'app', explorer: { app: ['app', 'app/src'] }, openFile: 'app/src/main.ts' }),
    );
    expect(restored).toMatchObject({ project: null, stack: null, openFile: null });
  });

  it('falls back to the root when a remembered folder is gone', async () => {
    await space.delete('app/src');
    const restored = await restoreSession(space, session({ project: 'app', explorer: { app: ['app', 'app/src'] } }));
    expect(restored.stack).toBeNull();
  });

  it('rejects stacks that do not descend one folder at a time from the root', async () => {
    await space.createDirectory('other');
    const restored = await restoreSession(space, session({ project: 'app', explorer: { app: ['other', 'app/src'] } }));
    expect(restored.stack).toBeNull();
  });

  it('does not reopen a file outside the restored project or one that is now a folder', async () => {
    await space.writeTextFile('loose.md', '');
    expect((await restoreSession(space, session({ project: 'app', openFile: 'loose.md' }))).openFile).toBeNull();
    await space.delete('app/src/main.ts');
    await space.createDirectory('app/src/main.ts');
    expect((await restoreSession(space, session({ project: 'app', openFile: 'app/src/main.ts' }))).openFile).toBeNull();
  });

  it('restores the space view when no project was open', async () => {
    await space.writeTextFile('loose.md', '');
    const restored = await restoreSession(space, session({ explorer: { '': [''] }, openFile: 'loose.md' }));
    expect(restored).toMatchObject({ project: null, stack: [''], openFile: 'loose.md' });
  });
});
