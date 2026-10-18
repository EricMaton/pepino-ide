import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandDispatcher, CommandRegistry } from '../../core/commands';
import { EventBus } from '../../core/events';
import { createActiveEditor } from '../editor/activeEditor';
import type { FileEntry } from '../projects/files';
import type { TextMatch } from '../workspace/workspace';
import { connect, serveSandbox } from './connection';
import { PluginHost, type PluginHostDeps } from './host';
import type { LoadedPlugin } from './loader';
import { parseManifest, type Permission } from './manifest';
import type { HostMessage, Port, WorkerMessage } from './protocol';
import type { SandboxHost } from './sandbox';

/*
 * The open project for plugins (#187): listed, read and searched with
 * fs.read, its paths relative to it, and nothing outside it.
 */
const channels: MessageChannel[] = [];
const connectOverChannel = (host: SandboxHost) => {
  const channel = new MessageChannel();
  channels.push(channel);
  serveSandbox(channel.port2 as unknown as Port<WorkerMessage, HostMessage>);
  const connection = connect(channel.port1 as unknown as Port<HostMessage, WorkerMessage>, host);
  channel.port1.start();
  channel.port2.start();
  return connection;
};

afterEach(() => {
  for (const channel of channels.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
});

const FILES: Record<string, string> = {
  'shop/src/cart.js': 'export const total = (items) => items.reduce((sum, item) => sum + item.price, 0);\n',
  'shop/README.md': '# Shop\nA cart with a total.\n',
  'shop/logo.png': 'PNG\u0000\u0001',
};

/** The workspace with [root] open, and the files above. */
function workspace(root: string): NonNullable<PluginHostDeps['workspace']> {
  const entries: FileEntry[] = Object.entries(FILES).map(([path, text]) => ({
    name: path.split('/').pop()!,
    path,
    isDirectory: false,
    sizeBytes: text.length,
    modifiedMillis: 0,
  }));
  return {
    getState: () => ({ root, activeFile: null, openFiles: [] }),
    listFiles: async () => entries,
    findFiles: async (query) => entries.map((entry) => entry.path).filter((path) => path.includes(query)),
    searchText: async (query) =>
      Object.entries(FILES).flatMap(([path, text]): TextMatch[] =>
        text
          .split('\n')
          .map((line, i) => ({ path, line: i + 1, column: line.indexOf(query) + 1, text: line }))
          .filter((match) => match.column > 0),
      ),
    readFile: async (path) => {
      if (!(path in FILES)) throw new Error(`Not found: ${path}`);
      return FILES[path];
    },
  };
}

function setUp(main: string, permissions: Permission[] = ['fs.read'], root = 'shop') {
  const parsed = parseManifest(
    JSON.stringify({
      id: 'dev.test.reader',
      name: 'Reader',
      version: '1.0.0',
      apiVersion: '1',
      permissions,
      contributes: { commands: [{ id: 'run', title: 'Run' }] },
    }),
  );
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  const plugin: LoadedPlugin = {
    manifest: parsed.manifest,
    main: `plugin.onActivate((api) => api.commands.register('run', async () => {
      const show = (value) => api.window.showMessage(JSON.stringify(value));
      ${main}
    }));`,
    assets: {},
    origin: 'test',
    builtin: false,
  };
  const registry = new CommandRegistry();
  const dispatcher = new CommandDispatcher(registry);
  const host = new PluginHost({
    registry,
    dispatcher,
    events: new EventBus<{
      'file.saved': { path: string };
      'file.opened': { path: string };
      'editor.changed': { path: string };
    }>(),
    activeEditor: createActiveEditor(),
    connect: connectOverChannel,
    workspace: workspace(root),
    options: { timeoutMs: 500, memoryBytes: 16 * 1024 * 1024 },
  });
  const notify = vi.fn();
  host.setNotifier(notify);
  const run = async () => {
    await host.start(plugin);
    await dispatcher.execute('dev.test.reader.run');
    return notify.mock.calls.map(([text]) => JSON.parse(String(text).slice('Reader: '.length)));
  };
  return { run };
}

describe('the project for plugins (#187)', () => {
  it('lists, reads, finds and searches the open project, its paths relative to it', async () => {
    const shown = await setUp(`
      await show(await api.fs.root());
      await show(await api.fs.list());
      await show(await api.fs.read('src/cart.js'));
      await show(await api.fs.find('cart'));
      await show(await api.fs.search('total'));
    `).run();
    expect(shown).toEqual([
      'shop',
      [
        { path: 'src/cart.js', size: FILES['shop/src/cart.js'].length },
        { path: 'README.md', size: FILES['shop/README.md'].length },
        { path: 'logo.png', size: FILES['shop/logo.png'].length },
      ],
      FILES['shop/src/cart.js'],
      ['src/cart.js'],
      [
        { path: 'src/cart.js', line: 1, column: 14, text: FILES['shop/src/cart.js'].split('\n')[0] },
        { path: 'README.md', line: 2, column: 15, text: 'A cart with a total.' },
      ],
    ]);
  });

  it('nothing outside the project, and no binary files', async () => {
    const shown = await setUp(`
      for (const path of ['../other/secret.txt', '/etc/hosts', 'src/../../x', 'logo.png']) {
        try { await api.fs.read(path); await show('read ' + path); } catch (error) { await show(error.message); }
      }
    `).run();
    expect(shown).toEqual([
      'Outside the project: ../other/secret.txt',
      'Outside the project: /etc/hosts',
      'Outside the project: src/../../x',
      'Not a text file: logo.png',
    ]);
  });

  it('needs a project open, and the fs.read permission', async () => {
    const closed = await setUp(
      `await show(await api.fs.root()); try { await api.fs.list(); } catch (error) { await show(error.message); }`,
      ['fs.read'],
      '',
    ).run();
    expect(closed).toEqual([null, 'No project is open']);

    const without = await setUp(
      `try { await api.fs.read('README.md'); } catch (error) { await show(error.message); }`,
      [],
    ).run();
    expect(without).toEqual(['Not allowed: fs.read']);
  });
});
