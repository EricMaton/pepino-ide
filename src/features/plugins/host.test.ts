import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandDispatcher, CommandRegistry } from '../../core/commands';
import { EventBus } from '../../core/events';
import { createActiveEditor } from '../editor/activeEditor';
import { connect, serveSandbox } from './connection';
import { PluginHost } from './host';
import type { LoadedPlugin } from './loader';
import { parseManifest, type Permission } from './manifest';
import type { HostMessage, Port, WorkerMessage } from './protocol';
import type { SandboxHost } from './sandbox';

/*
 * The plugins' host (#48): plugins in their sandbox over a MessageChannel
 * (as in a Worker), the app's command registry, event bus and editor.
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

function plugin(main: string, permissions: Permission[] = [], commands = ['run']): LoadedPlugin {
  const parsed = parseManifest(
    JSON.stringify({
      id: 'dev.test.tool',
      name: 'Tool',
      version: '1.0.0',
      apiVersion: '1',
      permissions,
      contributes: {
        commands: commands.map((id) => ({ id, title: `Run ${id}` })),
        settings: [{ key: 'name', type: 'string', default: 'Pepino' }],
      },
    }),
  );
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return { manifest: parsed.manifest, main, origin: 'test', builtin: false };
}

function setUp() {
  const registry = new CommandRegistry();
  const dispatcher = new CommandDispatcher(registry);
  const events = new EventBus<{
    'file.saved': { path: string };
    'file.opened': { path: string };
    'editor.changed': { path: string };
  }>();
  const activeEditor = createActiveEditor();
  let text = 'hello';
  activeEditor.set({ path: 'app/a.ts', getText: () => text, setText: (next) => void (text = next) });
  const host = new PluginHost({
    registry,
    dispatcher,
    events,
    activeEditor,
    connect: connectOverChannel,
    options: { timeoutMs: 200, memoryBytes: 16 * 1024 * 1024 },
  });
  const notify = vi.fn();
  host.setNotifier(notify);
  return { registry, dispatcher, events, host, notify, text: () => text };
}

describe('plugin host (#48)', () => {
  it('a hello world plugin registers a command that the palette lists and that runs', async () => {
    const { registry, dispatcher, host, notify } = setUp();
    await host.start(
      plugin(
        `plugin.onActivate((api) => {
          api.commands.register('run', () => api.window.showMessage('Hello, ' + api.settings.get('name')));
        });`,
      ),
    );

    expect(host.list().map((status) => status.state)).toEqual(['running']);
    expect(registry.find('dev.test.tool.run')?.title).toBe('Tool: Run run');
    await dispatcher.execute('dev.test.tool.run');
    expect(notify).toHaveBeenCalledWith('Tool: Hello, Pepino');

    await host.stop('dev.test.tool');
    expect(registry.all).toEqual([]);
    expect(host.list().map((status) => status.state)).toEqual(['stopped']);
  });

  it('reads and writes the editor with the permissions; without them, it is blocked and logged', async () => {
    const reading = setUp();
    await reading.host.start(
      plugin(
        `plugin.onActivate((api) => {
          api.commands.register('run', async () => {
            const text = await api.editor.getText();
            await api.editor.setText(text.toUpperCase());
          });
        });`,
        ['editor.read', 'editor.write'],
      ),
    );
    await reading.dispatcher.execute('dev.test.tool.run');
    expect(reading.text()).toBe('HELLO');

    const blocked = setUp();
    await blocked.host.start(
      plugin(
        `plugin.onActivate((api) => {
          api.commands.register('run', async () => api.editor.setText('pwned'));
        });`,
        ['editor.read'],
      ),
    );
    await expect(blocked.dispatcher.execute('dev.test.tool.run')).rejects.toThrow('Not allowed: editor.write');
    expect(blocked.text()).toBe('hello');
    expect(blocked.host.log('dev.test.tool').map((entry) => entry.text)).toContain(
      'Blocked editor.setText: the plugin may not use editor.write',
    );
  });

  it('passes on saves and opens at once, and edits once they pause', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { events, host } = setUp();
    await host.start(
      plugin(
        `plugin.onActivate((api) => {
          api.editor.onSave((file) => console.log('saved ' + file.path));
          api.editor.onChange((file) => console.log('changed ' + file.path));
        });`,
      ),
    );
    events.publish('file.saved', { path: 'app/a.ts' });
    events.publish('editor.changed', { path: 'app/a.ts' });
    events.publish('editor.changed', { path: 'app/a.ts' });
    vi.advanceTimersByTime(400);
    vi.useRealTimers();
    await vi.waitFor(() =>
      expect(host.log('dev.test.tool').map((entry) => entry.text)).toEqual(['saved app/a.ts', 'changed app/a.ts']),
    );
  });

  it('a plugin that fails to start says why, and registers nothing', async () => {
    const { registry, host } = setUp();
    await host.start(plugin(`plugin.onActivate(() => { throw new Error('broken on purpose'); });`));
    expect(host.list()[0]).toMatchObject({ state: 'failed', error: 'broken on purpose' });
    expect(registry.all).toEqual([]);
  });
});
