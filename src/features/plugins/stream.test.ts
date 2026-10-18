import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandDispatcher, CommandRegistry } from '../../core/commands';
import { EventBus } from '../../core/events';
import { createActiveEditor } from '../editor/activeEditor';
import { connect, serveSandbox } from './connection';
import { PluginHost } from './host';
import type { LoadedPlugin } from './loader';
import { parseManifest } from './manifest';
import type { HostMessage, Port, WorkerMessage } from './protocol';
import type { SandboxHost } from './sandbox';
import { memorySecretVault } from './secrets';

/*
 * Streaming answers (#58): api.network.stream hands the plugin each part of
 * the answer as it arrives, in order, with the user's key when it goes to
 * the key's host; a stream can be cancelled.
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
  vi.unstubAllGlobals();
});

/** An answer whose body comes in [parts]; it waits for [hold] before the last one. */
function streamed(parts: string[], hold?: Promise<unknown>) {
  return new Response(
    new ReadableStream({
      async start(controller) {
        for (const [i, part] of parts.entries()) {
          if (hold && i === parts.length - 1) await hold;
          controller.enqueue(new TextEncoder().encode(part));
        }
        controller.close();
      },
    }),
  );
}

async function setUp(main: string, fetcher: typeof fetch) {
  const parsed = parseManifest(
    JSON.stringify({
      id: 'dev.test.stream',
      name: 'Stream',
      version: '1.0.0',
      apiVersion: '1',
      permissions: ['network'],
      networkJustification: 'test',
      secrets: [{ key: 'k', label: 'Key', host: 'api.example.com', header: 'x-api-key' }],
      contributes: { commands: [{ id: 'run', title: 'Run' }] },
    }),
  );
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  const plugin: LoadedPlugin = { manifest: parsed.manifest, main, assets: {}, origin: 'test', builtin: false };
  vi.stubGlobal('fetch', fetcher);
  const vault = memorySecretVault(fetcher);
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
    secrets: vault,
    options: { timeoutMs: 500, memoryBytes: 16 * 1024 * 1024 },
  });
  const notify = vi.fn();
  host.setNotifier(notify);
  await host.start(plugin);
  return { host, plugin, dispatcher, notify };
}

const STREAMER = `plugin.onActivate((api) => api.commands.register('run', async () => {
  const parts = [];
  const answer = await api.network.stream('https://api.example.com/v1', { method: 'POST', body: '{}' }, (text) => parts.push(text));
  await api.window.showMessage(JSON.stringify({ parts, status: answer.status, text: answer.text }));
}));`;

describe('streaming answers (#58)', () => {
  it('each part reaches the plugin in order, all before the stream ends, with the key to its host', async () => {
    const seen: Record<string, string>[] = [];
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      seen.push({ ...(init?.headers as Record<string, string>) });
      return streamed(['data: a\n\n', 'data: b\n\n', 'data: c\n\n']);
    });
    const { host, plugin, dispatcher, notify } = await setUp(STREAMER, fetcher as unknown as typeof fetch);
    await host.saveSecret(plugin.manifest, 'k', 'sk-1');

    await dispatcher.execute('dev.test.stream.run');
    const shown = JSON.parse(notify.mock.calls[0][0].slice('Stream: '.length));
    expect(shown).toEqual({ parts: ['data: a\n\n', 'data: b\n\n', 'data: c\n\n'], status: 200, text: '' });
    expect(seen).toEqual([{ 'x-api-key': 'sk-1' }]);
  });

  it('streams without a key too, by the WebView', async () => {
    const fetcher = vi.fn(async () => streamed(['one ', 'two']));
    const { dispatcher, notify } = await setUp(STREAMER, fetcher as unknown as typeof fetch);
    await dispatcher.execute('dev.test.stream.run');
    expect(JSON.parse(notify.mock.calls[0][0].slice('Stream: '.length)).parts.join('')).toBe('one two');
  });

  it('a stream can be cancelled: it fails as Cancelled', async () => {
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => (release = resolve));
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      init?.signal?.addEventListener('abort', release);
      return streamed(
        ['first', 'never'],
        hold.then(() => init?.signal?.throwIfAborted()),
      );
    });
    const { dispatcher, notify } = await setUp(
      `plugin.onActivate((api) => api.commands.register('run', async () => {
        let answer;
        answer = api.network.stream('https://elsewhere.example.org/', {}, () => answer.cancel());
        try { await answer; await api.window.showMessage('finished'); }
        catch (error) { await api.window.showMessage(error.message); }
      }));`,
      fetcher as unknown as typeof fetch,
    );
    await dispatcher.execute('dev.test.stream.run');
    expect(notify).toHaveBeenCalledWith('Stream: Cancelled');
  });
});
