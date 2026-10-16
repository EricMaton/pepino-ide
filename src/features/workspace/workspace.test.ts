import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../core/events';
import { createMemoryBackend } from '../projects/memoryBackend';
import { type FsEvents, observeProjectSpace } from '../projects/observed';
import { createProjectSpace, type ProjectSpace } from '../projects/projectSpace';
import {
  createWorkspace,
  type OpenFilesStore,
  type SavedOpenFiles,
  type Workspace,
  type WorkspaceEvents,
} from './workspace';

let space: ProjectSpace;
let events: EventBus<FsEvents & WorkspaceEvents>;
let saved: Map<string, SavedOpenFiles>;
let workspace: Workspace;

const store: OpenFilesStore = {
  load: async (root) => saved.get(root) ?? { files: [], active: null },
  save: async (root, files, active) => void saved.set(root, { files: [...files], active }),
};

beforeEach(async () => {
  events = new EventBus();
  const raw = createProjectSpace(createMemoryBackend(() => 1));
  await raw.ensureCreated();
  space = observeProjectSpace(raw, (topic, payload) => events.publish(topic, payload as never));
  await space.createDirectory('app');
  await space.createDirectory('app/src');
  await space.createDirectory('app/src/ui');
  await space.writeTextFile('app/src/main.ts', 'import { greet } from "./ui/greet";\nconsole.log(greet("Pepino"));\n');
  await space.writeTextFile('app/src/ui/greet.ts', 'export const greet = (name: string) => `hola ${name}`;\n');
  await space.writeTextFile('app/README.md', '# App\nSay hola to Pepino.\n');
  await space.createDirectory('app/node_modules');
  await space.writeTextFile('app/node_modules/dep.js', 'hola');
  await space.createDirectory('other');
  await space.writeTextFile('other/secret.ts', 'hola');
  saved = new Map();
  workspace = createWorkspace(space, events, store);
  await workspace.setRoot('app');
});

describe('files', () => {
  it('lists the project files, skipping .pepino and node_modules', async () => {
    expect((await workspace.listFiles()).map((f) => f.path).sort()).toEqual([
      'app/README.md',
      'app/src/main.ts',
      'app/src/ui/greet.ts',
    ]);
  });

  it('refreshes the list when files change, from any source', async () => {
    await workspace.listFiles();
    await space.writeTextFile('app/src/new.ts', '');
    expect((await workspace.listFiles()).map((f) => f.path)).toContain('app/src/new.ts');
    await space.delete('app/src/new.ts');
    expect((await workspace.listFiles()).map((f) => f.path)).not.toContain('app/src/new.ts');
  });

  it('finds files by fuzzy name inside the project only', async () => {
    expect(await workspace.findFiles('greet')).toEqual(['app/src/ui/greet.ts']);
    expect(await workspace.findFiles('mts')).toEqual(['app/src/main.ts']);
    expect(await workspace.findFiles('secret')).toEqual([]);
    expect(await workspace.findFiles('  ')).toEqual([]);
  });
});

describe('searchText', () => {
  it('finds lines with line and column, case-insensitive by default', async () => {
    const matches = await workspace.searchText('HOLA');
    expect(matches.map((m) => `${m.path}:${m.line}:${m.column}`).sort()).toEqual([
      'app/README.md:2:5',
      'app/src/ui/greet.ts:1:41',
    ]);
  });

  it('can be case-sensitive and is capped', async () => {
    expect(await workspace.searchText('HOLA', { caseSensitive: true })).toEqual([]);
    expect(await workspace.searchText('o', { limit: 2 })).toHaveLength(2);
  });
});

describe('read, write and open', () => {
  it('reads and writes inside the root, never outside', async () => {
    await workspace.writeFile('app/notes.md', 'x');
    expect(await workspace.readFile('app/notes.md')).toBe('x');
    await expect(workspace.readFile('other/secret.ts')).rejects.toMatchObject({ code: 'EscapesRoot' });
    await expect(workspace.writeFile('../x', '')).rejects.toMatchObject({ code: 'EscapesRoot' });
  });

  it('asks the app to open existing files only', async () => {
    const requested = vi.fn();
    events.subscribe('workspace.openRequested', requested);
    await workspace.openFile('app/src/main.ts');
    expect(requested).toHaveBeenCalledWith({ path: 'app/src/main.ts' });
    await expect(workspace.openFile('app/src')).rejects.toMatchObject({ code: 'NotFound' });
    await expect(workspace.openFile('app/missing.ts')).rejects.toMatchObject({ code: 'NotFound' });
  });
});

describe('open files', () => {
  it('opens tabs next to the active one, without duplicates, and persists them per root', async () => {
    workspace.setActiveFile('app/src/main.ts');
    workspace.setActiveFile('app/README.md');
    workspace.setActiveFile('app/src/main.ts');
    workspace.setActiveFile('app/src/ui/greet.ts');
    expect(workspace.getState()).toMatchObject({
      activeFile: 'app/src/ui/greet.ts',
      openFiles: ['app/src/main.ts', 'app/src/ui/greet.ts', 'app/README.md'],
    });
    await Promise.resolve();
    expect(saved.get('app')).toEqual({
      files: ['app/src/main.ts', 'app/src/ui/greet.ts', 'app/README.md'],
      active: 'app/src/ui/greet.ts',
    });
  });

  it('has no limit on open files', () => {
    for (let i = 0; i < 30; i++) workspace.setActiveFile(`app/f${i}.ts`);
    expect(workspace.getState().openFiles).toHaveLength(30);
  });

  it('closing the active tab activates the one to its right, else the one to its left', () => {
    for (const file of ['app/a.ts', 'app/b.ts', 'app/c.ts']) workspace.setActiveFile(file);
    workspace.setActiveFile('app/b.ts');
    workspace.closeFile('app/b.ts');
    expect(workspace.getState()).toMatchObject({ activeFile: 'app/c.ts', openFiles: ['app/a.ts', 'app/c.ts'] });
    workspace.closeFile('app/c.ts');
    expect(workspace.getState()).toMatchObject({ activeFile: 'app/a.ts', openFiles: ['app/a.ts'] });
    workspace.closeFile('app/a.ts');
    expect(workspace.getState()).toMatchObject({ activeFile: null, openFiles: [] });
  });

  it('closing another tab keeps the active one', () => {
    workspace.setActiveFile('app/a.ts');
    workspace.setActiveFile('app/b.ts');
    workspace.closeFile('app/a.ts');
    expect(workspace.getState()).toMatchObject({ activeFile: 'app/b.ts', openFiles: ['app/b.ts'] });
  });

  it('follows renames and moves, and drops deleted files', async () => {
    workspace.setActiveFile('app/src/ui/greet.ts');
    workspace.setActiveFile('app/README.md');
    await space.rename('app/src/ui', 'components');
    expect(workspace.getState().openFiles).toEqual(['app/src/components/greet.ts', 'app/README.md']);
    await space.delete('app/README.md');
    expect(workspace.getState()).toMatchObject({
      activeFile: 'app/src/components/greet.ts',
      openFiles: ['app/src/components/greet.ts'],
    });
  });

  it('goes with the project when it is renamed, keeping its tabs', async () => {
    workspace.setActiveFile('app/README.md');
    await space.rename('app', 'renamed');
    expect(workspace.getState()).toMatchObject({ root: 'renamed', activeFile: 'renamed/README.md' });
    await workspace.setRoot('renamed');
    expect(workspace.getState().openFiles).toEqual(['renamed/README.md']);
    expect(saved.get('renamed')).toEqual({ files: ['renamed/README.md'], active: 'renamed/README.md' });
  });

  it('restores the saved tabs and the active one when the root changes, and notifies subscribers', async () => {
    workspace.setActiveFile('app/src/main.ts');
    workspace.setActiveFile('app/README.md');
    const listener = vi.fn();
    workspace.subscribe(listener);
    await workspace.setRoot('other');
    expect(workspace.getState()).toMatchObject({ root: 'other', activeFile: null, openFiles: [] });
    await workspace.setRoot('app');
    expect(workspace.getState()).toMatchObject({
      activeFile: 'app/README.md',
      openFiles: ['app/src/main.ts', 'app/README.md'],
    });
    expect(listener).toHaveBeenCalled();
  });

  it('forgets saved tabs whose files are gone', async () => {
    saved.set('app', { files: ['app/missing.ts', 'app/README.md', 'app/src'], active: 'app/missing.ts' });
    await workspace.setRoot('other');
    await workspace.setRoot('app');
    expect(workspace.getState()).toMatchObject({ activeFile: null, openFiles: ['app/README.md'] });
  });

  it('keeps a file opened while the saved tabs were still loading', async () => {
    saved.set('app', { files: ['app/README.md'], active: 'app/README.md' });
    await workspace.setRoot('other');
    const reopening = workspace.setRoot('app');
    workspace.setActiveFile('app/src/main.ts');
    await reopening;
    expect(workspace.getState()).toMatchObject({
      activeFile: 'app/src/main.ts',
      openFiles: ['app/src/main.ts', 'app/README.md'],
    });
  });

  it('rejects active files outside the root', () => {
    expect(() => workspace.setActiveFile('other/secret.ts')).toThrow('Outside the workspace');
  });
});
