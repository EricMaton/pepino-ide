import { afterEach, describe, expect, it } from 'vitest';
import { connect, type PluginConnection, serveSandbox } from './connection';
import type { HostMessage, Port, WorkerMessage } from './protocol';
import { PluginError, type SandboxHost } from './sandbox';

/*
 * The app and a plugin's worker over a real MessageChannel (#47): the same
 * messages a Worker carries, with the sandbox on the other end.
 */
const channels: MessageChannel[] = [];

function pair(host: SandboxHost): PluginConnection {
  const channel = new MessageChannel();
  channels.push(channel);
  serveSandbox(channel.port2 as unknown as Port<WorkerMessage, HostMessage>);
  const connection = connect(channel.port1 as unknown as Port<HostMessage, WorkerMessage>, host);
  channel.port1.start();
  channel.port2.start();
  return connection;
}

afterEach(() => {
  for (const channel of channels.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
});

const OPTIONS = { timeoutMs: 200, memoryBytes: 16 * 1024 * 1024 };

describe('plugin worker connection (#47)', () => {
  it('starts the plugin, runs its commands, and answers its api calls across the channel', async () => {
    const logged: string[] = [];
    const connection = pair({
      call: async (method, args) => (method === 'editor.getText' ? 'hola' : `${method}(${JSON.stringify(args)})`),
      log: (level, text) => logged.push(`${level}: ${text}`),
    });

    await connection.init(
      `plugin.onActivate((api) => {
        api.commands.register('echo', async () => {
          const text = await api.editor.getText();
          console.log(text, await api.window.showMessage(text + '!'));
        });
      });`,
      {},
      OPTIONS,
    );
    await connection.activate();
    expect(await connection.commands()).toEqual(['echo']);
    await connection.runCommand('echo');
    expect(logged).toEqual(['log: hola window.showMessage(["hola!"])']);
  });

  it('failures come back as PluginErrors, a timeout as such; a refused call as an error in the plugin', async () => {
    const logged: string[] = [];
    const connection = pair({
      call: async () => {
        throw new Error('Not allowed: editor.write');
      },
      log: (_level, text) => logged.push(text),
    });
    await connection.init(
      `plugin.onActivate((api) => {
        api.commands.register('hang', () => { while (true) {} });
        api.commands.register('write', () => api.editor.setText('x').catch((e) => console.log(e.message)));
      });`,
      {},
      OPTIONS,
    );
    await connection.activate();

    const error = await connection.runCommand('hang').catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(PluginError);
    expect((error as PluginError).timedOut).toBe(true);
    await connection.runCommand('write');
    expect(logged).toEqual(['Not allowed: editor.write']);
  });

  it('once terminated, what was pending fails and nothing more is sent', async () => {
    const connection = pair({ call: async () => undefined, log: () => undefined });
    const starting = connection.init('plugin.onActivate(() => {})', {}, OPTIONS);
    connection.terminate();
    await expect(starting).rejects.toThrow('stopped');
    await expect(connection.activate()).rejects.toThrow('stopped');
  });
});
