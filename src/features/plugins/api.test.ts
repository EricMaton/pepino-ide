import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandDispatcher, CommandRegistry } from '../../core/commands';
import { EventBus } from '../../core/events';
import { createActiveEditor } from '../editor/activeEditor';
import { connect, serveSandbox } from './connection';
import { PluginHost, type PluginPrompter, pluginStorageKey, STORAGE_LIMIT } from './host';
import type { LoadedPlugin } from './loader';
import { parseManifest, type Permission } from './manifest';
import type { HostMessage, Port, WorkerMessage } from './protocol';
import type { SandboxHost } from './sandbox';

/*
 * The api the example plugins asked for (#53): the editor's selection and
 * inserting at it, asking the user (a quick pick, a line of text), and a
 * plugin's own storage.
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

function plugin(main: string, permissions: Permission[] = []): LoadedPlugin {
  const parsed = parseManifest(
    JSON.stringify({
      id: 'dev.test.tool',
      name: 'Tool',
      version: '1.0.0',
      apiVersion: '1',
      permissions,
      contributes: { commands: [{ id: 'run', title: 'Run' }] },
    }),
  );
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return { manifest: parsed.manifest, main, origin: 'test', builtin: false };
}

function setUp(saved = new Map<string, string>()) {
  const registry = new CommandRegistry();
  const dispatcher = new CommandDispatcher(registry);
  const activeEditor = createActiveEditor();
  const editor = { inserted: [] as string[], snippets: [] as string[] };
  activeEditor.set({
    path: 'app/a.ts',
    getText: () => 'const a = 1;',
    setText: () => undefined,
    getSelection: () => 'a = 1',
    insert: (text) => void editor.inserted.push(text),
    insertSnippet: (body) => void editor.snippets.push(body),
  });
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
    storage: { get: async (key) => saved.get(key) ?? null, set: async (key, value) => void saved.set(key, value) },
    options: { timeoutMs: 200, memoryBytes: 16 * 1024 * 1024 },
  });
  const notify = vi.fn();
  host.setNotifier(notify);
  const run = async (main: string, permissions: Permission[] = []) => {
    await host.start(
      plugin(`plugin.onActivate((api) => api.commands.register('run', async () => { ${main} }));`, permissions),
    );
    await dispatcher.execute('dev.test.tool.run');
  };
  return { host, notify, editor, saved, run };
}

describe('plugin api for the example plugins (#53)', () => {
  it('reads the selection and inserts at it, with editor.read and editor.write', async () => {
    const { editor, notify, run } = setUp();
    await run(
      `const selected = await api.editor.getSelection();
       await api.editor.insert('[' + selected + ']');
       await api.editor.insertSnippet('if ($0) {\\n\\t\\n}');
       await api.window.showMessage(selected);`,
      ['editor.read', 'editor.write'],
    );
    expect(editor.inserted).toEqual(['[a = 1]']);
    expect(editor.snippets).toEqual(['if ($0) {\n\t\n}']);
    expect(notify).toHaveBeenCalledWith('Tool: a = 1');

    const blocked = setUp();
    await expect(blocked.run(`await api.editor.insert('x');`, ['editor.read'])).rejects.toThrow(
      'Not allowed: editor.write',
    );
  });

  it('asks the user to choose: the app shows the items, the plugin gets the index chosen', async () => {
    const { host, notify, run } = setUp();
    const quickPick = vi.fn<PluginPrompter['quickPick']>(async () => 1);
    host.setPrompter({ quickPick, input: async () => null });

    await run(
      `const chosen = await api.window.showQuickPick(['one', { label: 'two', detail: 'the second' }], { title: 'Pick' });
       await api.window.showMessage(String(chosen));`,
    );
    expect(quickPick).toHaveBeenCalledWith({
      plugin: 'Tool',
      title: 'Pick',
      items: [{ label: 'one' }, { label: 'two', detail: 'the second' }],
    });
    expect(notify).toHaveBeenCalledWith('Tool: 1');
  });

  it('a choice dismissed, out of range or with no app to ask is null', async () => {
    const { host, notify, run } = setUp();
    const main = `await api.window.showMessage(String(await api.window.showQuickPick(['one'])));`;
    await run(main);
    host.setPrompter({ quickPick: async () => 7, input: async () => null });
    await run(main);
    expect(notify.mock.calls).toEqual([['Tool: null'], ['Tool: null']]);
  });

  it('asks for a line of text', async () => {
    const { host, notify, run } = setUp();
    const input = vi.fn<PluginPrompter['input']>(async () => 'fetch json');
    host.setPrompter({ quickPick: async () => null, input });

    await run(`await api.window.showMessage(await api.window.showInput({ title: 'Name', value: 'x' }));`);
    expect(input).toHaveBeenCalledWith({ plugin: 'Tool', title: 'Name', value: 'x' });
    expect(notify).toHaveBeenCalledWith('Tool: fetch json');
  });

  it('keeps what a plugin stores, across starts, and refuses more than the limit', async () => {
    const first = setUp();
    await first.run(
      `await api.storage.set('list', [{ name: 'a' }]); await api.storage.set('gone', 1); await api.storage.delete('gone');`,
    );
    expect(JSON.parse(first.saved.get(pluginStorageKey('dev.test.tool'))!)).toEqual({ list: [{ name: 'a' }] });

    const again = setUp(first.saved);
    await again.run(
      `await api.window.showMessage(JSON.stringify([await api.storage.get('list'), await api.storage.get('none')]));`,
    );
    expect(again.notify).toHaveBeenCalledWith('Tool: [[{"name":"a"}],null]');

    await expect(again.run(`await api.storage.set('big', 'x'.repeat(${STORAGE_LIMIT}));`)).rejects.toThrow(
      'Storage is full: a plugin may keep 256 KB',
    );
    expect(JSON.parse(again.saved.get(pluginStorageKey('dev.test.tool'))!)).toEqual({ list: [{ name: 'a' }] });
  });
});
