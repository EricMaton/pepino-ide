import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandDispatcher, CommandRegistry } from '../../core/commands';
import { EventBus } from '../../core/events';
import { createActiveEditor } from '../editor/activeEditor';
import { connect, type PluginConnection, serveSandbox } from './connection';
import { PluginHost } from './host';
import { parseManifest } from './manifest';
import type { HostMessage, Port, WorkerMessage } from './protocol';
import { PluginError, type SandboxHost } from './sandbox';

/*
 * The last resort (#50): past the sandbox's own deadline, a worker that
 * stops answering is terminated and its plugin turned off; the app goes on.
 */
const channels: MessageChannel[] = [];
const channel = () => {
  const made = new MessageChannel();
  channels.push(made);
  made.port1.start();
  made.port2.start();
  return made;
};

afterEach(() => {
  for (const made of channels.splice(0)) {
    made.port1.close();
    made.port2.close();
  }
});

const quietHost = (overrides: Partial<SandboxHost> = {}): SandboxHost => ({
  call: async () => undefined,
  log: () => undefined,
  ...overrides,
});

describe('plugin watchdog (#50)', () => {
  it('a worker that never answers is terminated, and its host told', async () => {
    const { port1 } = channel();
    const terminate = vi.fn();
    const unresponsive = vi.fn();
    const connection = connect(port1 as unknown as Port<HostMessage, WorkerMessage>, quietHost({ unresponsive }), {
      terminate,
      watchdogMs: 100,
    });

    const error = await connection.activate().catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(PluginError);
    expect((error as PluginError).message).toBe('The plugin stopped responding for 0.1 s and was stopped');
    expect(terminate).toHaveBeenCalledOnce();
    expect(unresponsive).toHaveBeenCalledOnce();
    await expect(connection.runCommand('any')).rejects.toThrow('stopped');
  });

  it('waiting on the host is not being stuck', async () => {
    const { port1, port2 } = channel();
    // A worker that makes one slow api call, then answers
    port2.addEventListener('message', ({ data }: MessageEvent<HostMessage>) => {
      if (data.type === 'activate') {
        port2.postMessage({ type: 'call', call: 1, method: 'editor.getText', args: [] } satisfies WorkerMessage);
        const answer = ({ data: reply }: MessageEvent<HostMessage>) => {
          if (reply.type === 'reply') port2.postMessage({ type: 'done', seq: data.seq } satisfies WorkerMessage);
        };
        port2.addEventListener('message', answer);
      }
    });
    const terminate = vi.fn();
    const connection = connect(
      port1 as unknown as Port<HostMessage, WorkerMessage>,
      quietHost({ call: () => new Promise((resolve) => setTimeout(() => resolve('slow'), 1500)) }),
      { terminate, watchdogMs: 500 },
    );

    await connection.activate();
    expect(terminate).not.toHaveBeenCalled();
  });

  it('a plugin whose worker stops answering is turned off: failed, its commands gone, the user told', async () => {
    const registry = new CommandRegistry();
    let connection: PluginConnection | null = null;
    let sandboxHost: SandboxHost | null = null;
    const host = new PluginHost({
      registry,
      dispatcher: new CommandDispatcher(registry),
      events: new EventBus<{
        'file.saved': { path: string };
        'file.opened': { path: string };
        'editor.changed': { path: string };
      }>(),
      activeEditor: createActiveEditor(),
      connect: (given) => {
        sandboxHost = given;
        const { port1, port2 } = channel();
        serveSandbox(port2 as unknown as Port<WorkerMessage, HostMessage>);
        connection = connect(port1 as unknown as Port<HostMessage, WorkerMessage>, given);
        return connection;
      },
      options: { timeoutMs: 200, memoryBytes: 16 * 1024 * 1024 },
    });
    const notify = vi.fn();
    host.setNotifier(notify);
    const parsed = parseManifest(
      JSON.stringify({
        id: 'dev.test.stuck',
        name: 'Stuck',
        version: '1.0.0',
        apiVersion: '1',
        contributes: { commands: [{ id: 'go', title: 'Go' }] },
      }),
    );
    if (!parsed.ok) throw new Error('bad manifest');
    await host.start({
      manifest: parsed.manifest,
      main: `plugin.onActivate((api) => api.commands.register('go', () => {}));`,
      origin: 'test',
      builtin: false,
    });
    expect(registry.find('dev.test.stuck.go')).toBeDefined();

    // What the watchdog does when the worker goes silent
    sandboxHost!.unresponsive!();

    expect(host.list()[0]).toMatchObject({ state: 'failed', error: 'It stopped responding, and Pepino stopped it' });
    expect(registry.all).toEqual([]);
    expect(notify).toHaveBeenCalledWith('Stuck: It stopped responding, and Pepino stopped it');
    await expect(connection!.runCommand('go')).rejects.toThrow('stopped');
  });
});
