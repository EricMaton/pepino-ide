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
 * Managing a plugin (#57): the values the user gives its settings, which it
 * reads when it starts, and taking back what it was allowed.
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

const GREETER: PluginSource = {
  list: async () => [
    {
      origin: 'test',
      builtin: false,
      main: `plugin.onActivate((api) => api.commands.register('greet', async () => {
        const text = await api.editor.getText();
        await api.window.showMessage(api.settings.get('greeting') + ' ' + text + (api.settings.get('loud') ? '!' : ''));
      }));`,
      manifest: JSON.stringify({
        id: 'dev.test.greeter',
        name: 'Greeter',
        version: '1.0.0',
        apiVersion: '1',
        permissions: ['editor.read'],
        contributes: {
          commands: [{ id: 'greet', title: 'Greet' }],
          settings: [
            { key: 'greeting', type: 'string', default: 'Hello', title: 'Greeting' },
            { key: 'loud', type: 'boolean', default: false },
          ],
        },
      }),
    },
  ],
};

function setUp(saved = new Map<string, string>()) {
  const preferences = {
    get: async (key: string) => saved.get(key) ?? null,
    set: async (key: string, value: string) => void saved.set(key, value),
  };
  const registry = new CommandRegistry();
  const dispatcher = new CommandDispatcher(registry);
  const activeEditor = createActiveEditor();
  activeEditor.set({
    path: 'a.txt',
    getText: () => 'world',
    setText: () => undefined,
    getSelection: () => '',
    insert: () => undefined,
    insertSnippet: () => undefined,
  });
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
    settings: (plugin) => permissions.settings(plugin),
    options: { timeoutMs: 500, memoryBytes: 16 * 1024 * 1024 },
  });
  const notify = vi.fn();
  host.setNotifier(notify);
  const manager = new PluginManager(host, permissions, () => [GREETER]);
  return { manager, registry, dispatcher, notify, saved };
}

describe('managing a plugin (#57)', () => {
  it('its settings: the defaults, then the user’s values, which it reads at once and after a restart', async () => {
    const { manager, dispatcher, notify, saved } = setUp();
    await manager.load();
    await manager.approve('dev.test.greeter');
    expect(manager.settings('dev.test.greeter')).toEqual({ greeting: 'Hello', loud: false });
    await dispatcher.execute('dev.test.greeter.greet');
    expect(notify).toHaveBeenLastCalledWith('Greeter: Hello world');

    // A value of the wrong type, or for a setting it does not have, is not kept
    await manager.setSettings('dev.test.greeter', { greeting: 'Hola', loud: true, other: 1 });
    await manager.setSettings('dev.test.greeter', { loud: 'yes' });
    expect(manager.settings('dev.test.greeter')).toEqual({ greeting: 'Hola', loud: true });
    await dispatcher.execute('dev.test.greeter.greet');
    expect(notify).toHaveBeenLastCalledWith('Greeter: Hola world!');

    const again = setUp(saved);
    await again.manager.load();
    await again.dispatcher.execute('dev.test.greeter.greet');
    expect(again.notify).toHaveBeenLastCalledWith('Greeter: Hola world!');
    expect(JSON.parse(saved.get(PLUGINS_STATE_KEY)!)['dev.test.greeter'].settings).toEqual({
      greeting: 'Hola',
      loud: true,
    });
  });

  it('taking back its permissions stops it until the user allows it again', async () => {
    const { manager, registry } = setUp();
    await manager.load();
    await manager.approve('dev.test.greeter');
    expect(registry.find('dev.test.greeter.greet')).toBeDefined();

    await manager.revoke('dev.test.greeter');
    expect(manager.entries()[0]).toMatchObject({ state: 'needs-approval', missing: ['editor.read'] });
    expect(registry.all).toEqual([]);

    await manager.approve('dev.test.greeter');
    expect(manager.entries()[0].state).toBe('running');
  });
});
