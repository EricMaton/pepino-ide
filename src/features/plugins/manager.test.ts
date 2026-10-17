import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandDispatcher, CommandRegistry } from '../../core/commands';
import { EventBus } from '../../core/events';
import { createActiveEditor } from '../editor/activeEditor';
import { connect, serveSandbox } from './connection';
import { PluginHost } from './host';
import type { PluginSource } from './loader';
import { PluginManager } from './manager';
import { createPluginPermissions, PLUGINS_STATE_KEY } from './permissions';
import type { HostMessage, Port, WorkerMessage } from './protocol';
import type { SandboxHost } from './sandbox';

/*
 * Permissions (#49): approved by the user before a plugin runs, checked by
 * the host on every call, asked again for what a new version adds.
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

const READER = `plugin.onActivate((api) => {
  api.commands.register('read', async () => api.window.showMessage(await api.editor.getText()));
  api.commands.register('fetch', async () => {
    console.log(typeof api.network);
  });
});`;

function source(permissions: string[], version = '1.0.0'): PluginSource {
  return {
    list: async () => [
      {
        origin: 'test',
        builtin: false,
        main: READER,
        manifest: JSON.stringify({
          id: 'dev.test.reader',
          name: 'Reader',
          version,
          apiVersion: '1',
          permissions,
          ...(permissions.includes('network') && { networkJustification: 'to test' }),
          contributes: {
            commands: [
              { id: 'read', title: 'Read' },
              { id: 'fetch', title: 'Fetch' },
            ],
          },
        }),
      },
    ],
  };
}

function setUp(permissions: string[], saved: Record<string, string> = {}) {
  const preferences = new Map(Object.entries(saved));
  const store = {
    get: async (key: string) => preferences.get(key) ?? null,
    set: async (key: string, value: string) => void preferences.set(key, value),
  };
  const registry = new CommandRegistry();
  const dispatcher = new CommandDispatcher(registry);
  const activeEditor = createActiveEditor();
  activeEditor.set({
    path: 'a.txt',
    getText: () => 'secret',
    setText: () => undefined,
    getSelection: () => '',
    insert: () => undefined,
    insertSnippet: () => undefined,
  });
  const pluginPermissions = createPluginPermissions(store);
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
    allowed: (plugin, permission) => pluginPermissions.allowed(plugin, permission),
    options: { timeoutMs: 200, memoryBytes: 16 * 1024 * 1024 },
  });
  const notify = vi.fn();
  host.setNotifier(notify);
  let current = permissions;
  const manager = new PluginManager(host, pluginPermissions, () => [source(current)]);
  return {
    manager,
    registry,
    dispatcher,
    notify,
    preferences,
    host,
    ask: (next: string[]) => (current = next),
  };
}

describe('plugin permissions (#49)', () => {
  it('a plugin asking for permissions waits for the user, then runs with them', async () => {
    const { manager, registry, dispatcher, notify, preferences } = setUp(['editor.read']);
    await manager.load();

    expect(manager.entries()[0]).toMatchObject({ state: 'needs-approval', missing: ['editor.read'] });
    expect(registry.all).toEqual([]);

    await manager.approve('dev.test.reader');
    expect(manager.entries()[0]).toMatchObject({ state: 'running', missing: [] });
    await dispatcher.execute('dev.test.reader.read');
    expect(notify).toHaveBeenCalledWith('Reader: secret');
    expect(JSON.parse(preferences.get(PLUGINS_STATE_KEY)!)).toEqual({
      'dev.test.reader': { enabled: true, approved: ['editor.read'] },
    });
  });

  it('remembers what was approved; a new version asking for more is asked about again', async () => {
    const saved = {
      [PLUGINS_STATE_KEY]: JSON.stringify({ 'dev.test.reader': { enabled: true, approved: ['editor.read'] } }),
    };
    const first = setUp(['editor.read'], saved);
    await first.manager.load();
    expect(first.manager.entries()[0].state).toBe('running');

    const updated = setUp(['editor.read', 'editor.write'], saved);
    await updated.manager.load();
    expect(updated.manager.entries()[0]).toMatchObject({ state: 'needs-approval', missing: ['editor.write'] });
  });

  it('turned off, its commands go; on again, they come back', async () => {
    const { manager, registry } = setUp([]);
    await manager.load();
    expect(registry.find('dev.test.reader.read')).toBeDefined();

    await manager.setEnabled('dev.test.reader', false);
    expect(manager.entries()[0].state).toBe('off');
    expect(registry.all).toEqual([]);

    await manager.setEnabled('dev.test.reader', true);
    expect(manager.entries()[0].state).toBe('running');
  });

  it('declared but not approved is refused by the host, and logged', async () => {
    const { manager, dispatcher, host } = setUp([]);
    await manager.load();
    // Its manifest asks for nothing: reading the editor is refused
    await expect(dispatcher.execute('dev.test.reader.read')).rejects.toThrow('Not allowed: editor.read');
    expect(host.log('dev.test.reader').map((entry) => entry.text)).toEqual([
      'Blocked editor.getText: the plugin may not use editor.read',
      'read: Not allowed: editor.read',
    ]);
  });

  it('only a plugin allowed the network gets api.network', async () => {
    const without = setUp([]);
    await without.manager.load();
    await without.dispatcher.execute('dev.test.reader.fetch');
    expect(without.host.log('dev.test.reader').at(-1)?.text).toBe('undefined');

    const allowed = setUp(['network']);
    await allowed.manager.load();
    await allowed.manager.approve('dev.test.reader');
    await allowed.dispatcher.execute('dev.test.reader.fetch');
    expect(allowed.host.log('dev.test.reader').at(-1)?.text).toBe('object');
  });
});
