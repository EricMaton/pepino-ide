import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandDispatcher, CommandRegistry } from '../../core/commands';
import { EventBus } from '../../core/events';
import { createActiveEditor } from '../editor/activeEditor';
import { connect, serveSandbox } from './connection';
import { PluginHost, pluginStorageKey } from './host';
import { installedPlugins, memoryPluginFolders, type PluginFolders } from './installed';
import { builtinSource } from './loader';
import { PluginManager } from './manager';
import { createPluginPermissions, PLUGINS_STATE_KEY } from './permissions';
import type { HostMessage, Port, WorkerMessage } from './protocol';
import { createRegistry, parseIndex, type RegistryEntry } from './registry';
import type { SandboxHost } from './sandbox';

/*
 * Installing and uninstalling plugins (#56): from the repository's index,
 * each file checked against its hash, approved for what the user was shown,
 * kept between starts; uninstalled without a restart, nothing left behind.
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

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

const MANIFEST = (version = '1.0.0', permissions = ['editor.read']) =>
  JSON.stringify({
    id: 'dev.test.counter',
    name: 'Counter',
    version,
    apiVersion: '1',
    permissions,
    contributes: { commands: [{ id: 'count', title: 'Count' }] },
  });
const MAIN = `plugin.onActivate((api) => api.commands.register('count', async () => {
  const count = ((await api.storage.get('count')) || 0) + 1;
  await api.storage.set('count', count);
  await api.window.showMessage(String(count));
}));`;

/** A repository serving [files] by path, with an index listing them as [entry]. */
function repository(files: Record<string, string>, entry: Partial<RegistryEntry> = {}) {
  const index = {
    schema: 1,
    plugins: [
      {
        id: 'dev.test.counter',
        name: 'Counter',
        version: '1.0.0',
        apiVersion: '1',
        permissions: ['editor.read'],
        path: 'plugins/counter',
        files: Object.fromEntries(
          Object.entries(files)
            .filter(([path]) => path.startsWith('plugins/counter/'))
            .map(([path, text]) => [path.slice('plugins/counter/'.length), sha256(text)]),
        ),
        ...entry,
      },
    ],
  };
  const served: Record<string, string> = { 'index.json': JSON.stringify(index), ...files };
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    const path = new URL(String(url)).pathname.slice(1);
    const text = served[path];
    return text === undefined ? new Response('', { status: 404 }) : new Response(text);
  });
  return { registry: createRegistry(fetcher as typeof fetch, 'https://repo.test/'), served, fetcher };
}

function setUp(folders: PluginFolders = memoryPluginFolders(), saved = new Map<string, string>()) {
  const preferences = {
    get: async (key: string) => saved.get(key) ?? null,
    set: async (key: string, value: string) => void saved.set(key, value),
  };
  const registry = new CommandRegistry();
  const dispatcher = new CommandDispatcher(registry);
  const activeEditor = createActiveEditor();
  const permissions = createPluginPermissions(preferences);
  const host = new PluginHost({
    registry,
    dispatcher,
    events: new EventBus<{
      'file.saved': { path: string };
      'file.opened': { path: string };
      'editor.changed': { path: string };
    }>(),
    activeEditor,
    connect: connectOverChannel,
    allowed: (plugin, permission) => permissions.allowed(plugin, permission),
    storage: preferences,
    options: { timeoutMs: 500, memoryBytes: 16 * 1024 * 1024 },
  });
  const notify = vi.fn();
  host.setNotifier(notify);
  const installed = installedPlugins(folders);
  const manager = new PluginManager(host, permissions, () => [installed], installed);
  return { manager, registry, dispatcher, notify, folders, saved };
}

const FILES = { 'plugins/counter/plugin.json': MANIFEST(), 'plugins/counter/main.js': MAIN };

describe('the plugins repository (#55, #56)', () => {
  it('lists the index’s plugins, leaving out an entry that does not hold', () => {
    const entries = parseIndex(
      JSON.stringify({
        schema: 1,
        plugins: [
          {
            id: 'a.b',
            name: 'A',
            version: '1.0.0',
            apiVersion: '1',
            permissions: [],
            path: 'plugins/a',
            files: { 'plugin.json': 'a'.repeat(64) },
          },
          {
            id: 'c.d',
            name: 'Out of its folder',
            version: '1.0.0',
            apiVersion: '1',
            permissions: [],
            path: '../etc',
            files: { 'plugin.json': 'a'.repeat(64) },
          },
          {
            id: 'e.f',
            name: 'Odd file',
            version: '1.0.0',
            apiVersion: '1',
            permissions: [],
            path: 'plugins/e',
            files: { 'plugin.json': 'a'.repeat(64), 'run.sh': 'a'.repeat(64) },
          },
          {
            id: 'g.h',
            name: 'Odd permission',
            version: '1.0.0',
            apiVersion: '1',
            permissions: ['root'],
            path: 'plugins/g',
            files: { 'plugin.json': 'a'.repeat(64) },
          },
        ],
      }),
    );
    expect(entries.map((entry) => entry.id)).toEqual(['a.b']);
    expect(() => parseIndex('{"schema":2,"plugins":[]}')).toThrow('not one this Pepino reads');
  });

  it('downloads a plugin’s files, and refuses one that is not what the index lists', async () => {
    const { registry, served } = repository(FILES);
    const [entry] = await registry.list();
    expect(await registry.download(entry)).toEqual({ manifest: MANIFEST(), main: MAIN, assets: {} });

    // Each request asks past GitHub's CDN cache, which keeps a file for 5 minutes
    const { fetcher } = repository(FILES);
    await createRegistry(fetcher as typeof fetch, 'https://repo.test/').list();
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get('fresh')).toMatch(/^\d+$/);

    served['plugins/counter/main.js'] = MAIN.replace('+ 1', '+ 1000');
    await expect(registry.download(entry)).rejects.toThrow(
      'Counter: main.js is not the file the index lists; nothing was installed',
    );
  });

  it('says so when it cannot reach the repository', async () => {
    const registry = createRegistry((async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch);
    await expect(registry.list()).rejects.toThrow('Cannot reach the plugins repository: are you online?');
  });
});

describe('installing and uninstalling plugins (#56)', () => {
  it('installs: kept, approved for what was shown, started; and still there after a restart', async () => {
    const { registry: repo } = repository(FILES);
    const { manager, dispatcher, notify, folders, saved } = setUp();
    await manager.load();
    const [entry] = await repo.list();

    await manager.install(await repo.download(entry), entry);
    expect(manager.entries()[0]).toMatchObject({ state: 'running', plugin: { origin: 'installed:dev.test.counter' } });
    await dispatcher.execute('dev.test.counter.count');
    expect(notify).toHaveBeenLastCalledWith('Counter: 1');
    expect(JSON.parse(saved.get(PLUGINS_STATE_KEY)!)).toEqual({
      'dev.test.counter': { enabled: true, approved: ['editor.read'] },
    });

    // The app starts again: it is there, with what it kept
    const again = setUp(folders, saved);
    await again.manager.load();
    await again.dispatcher.execute('dev.test.counter.count');
    expect(again.notify).toHaveBeenLastCalledWith('Counter: 2');
  });

  it('refuses a plugin asking for more than the user was shown, or that is not the one asked for', async () => {
    const { manager, registry } = setUp();
    await manager.load();
    const shown = { id: 'dev.test.counter', permissions: ['editor.read'] as const };

    await expect(
      manager.install({ manifest: MANIFEST('1.0.0', ['editor.read', 'editor.write']), main: MAIN }, shown),
    ).rejects.toThrow('Counter asks for more than the repository says: editor.write');
    await expect(
      manager.install({ manifest: MANIFEST(), main: MAIN }, { ...shown, id: 'dev.test.other' }),
    ).rejects.toThrow('The repository sent dev.test.counter, not dev.test.other');
    await expect(manager.install({ manifest: '{', main: MAIN }, shown)).rejects.toThrow(
      'Not a plugin this Pepino runs',
    );
    expect(manager.entries()).toEqual([]);
    expect(registry.all).toEqual([]);
  });

  it('updates to a newer version in place', async () => {
    const { manager } = setUp();
    await manager.load();
    const shown = { id: 'dev.test.counter', permissions: ['editor.read'] as const };
    await manager.install({ manifest: MANIFEST('1.0.0'), main: MAIN }, shown);
    await manager.install({ manifest: MANIFEST('1.1.0'), main: MAIN }, shown);

    expect(manager.entries().map((entry) => [entry.plugin.manifest.version, entry.state])).toEqual([
      ['1.1.0', 'running'],
    ]);
  });

  it('uninstalls without a restart: its commands, files, permissions and data all gone', async () => {
    const { manager, registry, dispatcher, folders, saved } = setUp();
    await manager.load();
    await manager.install(
      { manifest: MANIFEST(), main: MAIN },
      { id: 'dev.test.counter', permissions: ['editor.read'] },
    );
    await dispatcher.execute('dev.test.counter.count');

    await manager.uninstall('dev.test.counter');
    expect(registry.all).toEqual([]);
    expect(manager.entries()).toEqual([]);
    expect(await folders.ids()).toEqual([]);
    expect(JSON.parse(saved.get(PLUGINS_STATE_KEY)!)).toEqual({});
    expect(saved.get(pluginStorageKey('dev.test.counter'))).toBe('{}');
    await expect(dispatcher.execute('dev.test.counter.count')).rejects.toThrow();
  });

  it('what comes with Pepino is turned off, not uninstalled', async () => {
    const { manager } = setUp();
    const builtin = new PluginManager(
      (manager as unknown as { host: PluginHost }).host,
      createPluginPermissions({ get: async () => null, set: async () => undefined }),
      () => [builtinSource()],
      installedPlugins(memoryPluginFolders()),
    );
    await builtin.load();
    await expect(builtin.uninstall('dev.pepino.hello-world')).rejects.toThrow(
      'Hello world comes with Pepino: turn it off instead',
    );
  });
});
