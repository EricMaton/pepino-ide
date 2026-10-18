import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseNavOrder } from '../../app/navLayout';
import { CommandDispatcher, CommandRegistry } from '../../core/commands';
import { EventBus } from '../../core/events';
import { createActiveEditor } from '../editor/activeEditor';
import { connect, serveSandbox } from './connection';
import { PluginHost } from './host';
import { installedPlugins, memoryPluginFolders } from './installed';
import { builtinSource, loadPlugins, type PluginSource } from './loader';
import { PluginManager } from './manager';
import { parseManifest } from './manifest';
import { PAGE_CSP, pageHead } from './pageDocument';
import { createPluginPermissions } from './permissions';
import type { HostMessage, Port, WorkerMessage } from './protocol';
import { createRegistry } from './registry';
import type { SandboxHost } from './sandbox';

/*
 * A plugin's own pages (#185): declared in its manifest, shipped as HTML
 * files, shown as destinations while it runs, and talking only to it.
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

const MANIFEST = JSON.stringify({
  id: 'dev.test.echo',
  name: 'Echo',
  version: '1.0.0',
  apiVersion: '1',
  contributes: { pages: [{ id: 'main', title: 'Echo', file: 'echo.html' }] },
});
const MAIN = `plugin.onActivate((api) => {
  api.pages.onMessage('main', (data) => api.pages.postMessage('main', { echo: data }));
});`;
const HTML = '<p>echo</p>';

const echo = (assets: Record<string, string> = { 'echo.html': HTML }): PluginSource => ({
  list: async () => [{ origin: 'test', manifest: MANIFEST, main: MAIN, assets, builtin: false }],
});

function setUp(source: PluginSource = echo()) {
  const registry = new CommandRegistry();
  const host = new PluginHost({
    registry,
    dispatcher: new CommandDispatcher(registry),
    events: new EventBus<{
      'file.saved': { path: string };
      'file.opened': { path: string };
      'editor.changed': { path: string };
    }>(),
    activeEditor: createActiveEditor(),
    connect: connectOverChannel,
    options: { timeoutMs: 500, memoryBytes: 16 * 1024 * 1024 },
  });
  const permissions = createPluginPermissions({ get: async () => null, set: async () => undefined });
  const manager = new PluginManager(host, permissions, () => [source]);
  return { host, manager };
}

describe('plugin pages (#185)', () => {
  it('a manifest declares its pages, each an .html file of its own', () => {
    expect(parseManifest(MANIFEST)).toMatchObject({
      ok: true,
      manifest: { contributes: { pages: [{ id: 'main', title: 'Echo', file: 'echo.html' }] } },
    });
    const wrong = parseManifest(
      JSON.stringify({
        ...JSON.parse(MANIFEST),
        contributes: {
          pages: [
            { id: 'a', title: 'A', file: '../../secrets.html' },
            { id: 'b', title: 'B', file: 'script.js' },
            { id: 'c c', title: 'C', file: 'c.html' },
          ],
        },
      }),
    );
    expect(wrong).toEqual({
      ok: false,
      errors: [
        "contributes.pages[0].file: an .html file in the plugin's folder",
        "contributes.pages[1].file: an .html file in the plugin's folder",
        'contributes.pages[2]: { id, title, file }',
      ],
    });
  });

  it('a plugin whose page file is missing is not loaded; Hello world comes with its page', async () => {
    expect((await loadPlugins([echo({})])).rejected).toEqual([{ origin: 'test', errors: ['echo.html: not found'] }]);
    const { plugins } = await loadPlugins([builtinSource()]);
    const hello = plugins.find((plugin) => plugin.manifest.id === 'dev.pepino.hello-world');
    expect(hello?.assets['hello.html']).toContain('pepino.postMessage');
  });

  it('shows the pages of the running plugins only', async () => {
    const { manager } = setUp();
    await manager.load();
    expect(manager.pages()).toEqual([
      {
        destination: 'plugin:dev.test.echo.main',
        pluginId: 'dev.test.echo',
        pageId: 'main',
        title: 'Echo',
        plugin: 'Echo',
        html: HTML,
      },
    ]);
    await manager.setEnabled('dev.test.echo', false);
    expect(manager.pages()).toEqual([]);
  });

  it('carries messages between a page and its plugin, and only to its own pages', async () => {
    const { host, manager } = setUp();
    const sink = vi.fn();
    host.setPageSink(sink);
    await manager.load();

    await host.fromPage('dev.test.echo', 'main', { said: 'hi' });
    await vi.waitFor(() => expect(sink).toHaveBeenCalledWith('dev.test.echo', 'main', { echo: { said: 'hi' } }));

    // Nothing reaches a plugin that is not running
    await manager.setEnabled('dev.test.echo', false);
    sink.mockClear();
    await host.fromPage('dev.test.echo', 'main', 'still there?');
    expect(sink).not.toHaveBeenCalled();
  });

  it('installs a page from the repository, its file checked like the others', async () => {
    const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
    const served: Record<string, string> = {
      'index.json': JSON.stringify({
        schema: 1,
        plugins: [
          {
            id: 'dev.test.echo',
            name: 'Echo',
            version: '1.0.0',
            apiVersion: '1',
            permissions: [],
            path: 'plugins/echo',
            files: { 'plugin.json': sha256(MANIFEST), 'main.js': sha256(MAIN), 'echo.html': sha256(HTML) },
          },
        ],
      }),
      'plugins/echo/plugin.json': MANIFEST,
      'plugins/echo/main.js': MAIN,
      'plugins/echo/echo.html': HTML,
    };
    const repository = createRegistry(
      (async (url: string) => new Response(served[new URL(String(url)).pathname.slice(1)])) as typeof fetch,
      'https://repo.test/',
    );
    const folders = memoryPluginFolders();
    const installed = installedPlugins(folders);
    const { host } = setUp({ list: async () => [] });
    const manager = new PluginManager(
      host,
      createPluginPermissions({ get: async () => null, set: async () => undefined }),
      () => [installed],
      installed,
    );
    await manager.load();
    const [entry] = await repository.list();
    await manager.install(await repository.download(entry), entry);

    expect(manager.pages().map((page) => [page.destination, page.html])).toEqual([['plugin:dev.test.echo.main', HTML]]);
    expect((await folders.read('dev.test.echo'))?.assets).toEqual({ 'echo.html': HTML });
  });

  it('a page’s document starts with a policy that allows no network, then the theme and the bridge', () => {
    const head = pageHead({ '--bg': '#0a0a0a', '--primary': 'red; } body { display: none', '--secret': 'x' });
    expect(head.startsWith(`<meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}">`)).toBe(true);
    expect(PAGE_CSP).toContain("default-src 'none'");
    expect(head).toContain('--bg: #0a0a0a;');
    // A token cannot break out of its declaration, and only the app's tokens go in
    expect(head).toContain('--primary: red  body  display: none;');
    expect(head).not.toContain('--secret');
    expect(head).toContain('pepino');
  });

  it('the bar remembers where a plugin’s page goes, even before its plugin loads', () => {
    expect(
      parseNavOrder('{"bar":["projects","plugin:dev.test.echo.main","settings"],"more":["plugin:bad","git"]}', [
        'projects',
        'git',
        'settings',
      ]),
    ).toEqual({ bar: ['projects', 'plugin:dev.test.echo.main', 'settings'], more: ['git'] });
  });
});
