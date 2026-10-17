import { describe, expect, it, vi } from 'vitest';
import { createSandbox, PluginError, type SandboxHost } from './sandbox';

/** A host that answers calls from [replies] and keeps what the plugin logged. */
function host(replies: Record<string, (args: unknown[]) => unknown> = {}) {
  const logged: string[] = [];
  const calls: [string, unknown[]][] = [];
  const sandboxHost: SandboxHost = {
    async call(method, args) {
      calls.push([method, args]);
      const reply = replies[method];
      if (!reply) throw new Error(`No ${method} here`);
      return reply(args);
    },
    log: (level, text) => logged.push(`${level}: ${text}`),
  };
  return { sandboxHost, logged, calls };
}

const FAST = { timeoutMs: 200, memoryBytes: 16 * 1024 * 1024 };

describe('plugin sandbox (#47)', () => {
  it('runs main.js, activates it, and runs the commands it registers', async () => {
    const { sandboxHost, calls } = host({ 'window.showMessage': () => undefined });
    const sandbox = await createSandbox(
      `plugin.onActivate((api) => {
        api.commands.register('hello', async () => {
          await api.window.showMessage('Hello, ' + api.settings.get('name'));
        });
      });`,
      { name: 'Pepino' },
      sandboxHost,
      FAST,
    );

    await sandbox.activate();
    expect(await sandbox.commands()).toEqual(['hello']);
    await sandbox.runCommand('hello');
    expect(calls).toEqual([['window.showMessage', ['Hello, Pepino']]]);
    sandbox.dispose();
  });

  it('awaits the host: replies come back as data, refusals as exceptions in the plugin', async () => {
    const { sandboxHost, logged } = host({
      'editor.getText': () => 'const a = 1;',
      'editor.setText': () => {
        throw new Error('Not allowed: editor.write');
      },
    });
    const sandbox = await createSandbox(
      `plugin.onActivate((api) => {
        api.commands.register('upper', async () => {
          const text = await api.editor.getText();
          try {
            await api.editor.setText(text.toUpperCase());
          } catch (error) {
            console.warn('refused:', error.message);
          }
        });
      });`,
      {},
      sandboxHost,
      FAST,
    );
    await sandbox.activate();
    await sandbox.runCommand('upper');
    expect(logged).toEqual(['warn: refused: Not allowed: editor.write']);
    sandbox.dispose();
  });

  it('a plugin cannot reach the host’s globals', async () => {
    const { sandboxHost, logged } = host();
    const sandbox = await createSandbox(
      `console.log(typeof fetch, typeof window, typeof document, typeof __host, typeof require);`,
      {},
      sandboxHost,
      FAST,
    );
    await sandbox.activate();
    expect(logged).toEqual(['log: undefined undefined undefined undefined undefined']);
    sandbox.dispose();
  });

  it('a while (true) is interrupted, and the plugin lives on', async () => {
    const { sandboxHost } = host();
    const sandbox = await createSandbox(
      `plugin.onActivate((api) => {
        api.commands.register('hang', () => { while (true) {} });
        api.commands.register('fine', () => 42);
      });`,
      {},
      sandboxHost,
      FAST,
    );
    await sandbox.activate();

    const started = Date.now();
    const error = await sandbox.runCommand('hang').catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(PluginError);
    expect((error as PluginError).timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
    await expect(sandbox.runCommand('fine')).resolves.toBeUndefined();
    sandbox.dispose();
  });

  it('events reach the listeners; errors in the plugin come out as PluginErrors', async () => {
    const { sandboxHost, logged } = host();
    const sandbox = await createSandbox(
      `plugin.onActivate((api) => {
        api.editor.onSave((file) => console.log('saved', file.path));
        api.commands.register('broken', () => { throw new TypeError('nope'); });
      });
      plugin.onDeactivate(() => console.log('bye'));`,
      {},
      sandboxHost,
      FAST,
    );
    await sandbox.activate();
    await sandbox.emit('file.saved', { path: 'app/a.ts' });
    await sandbox.emit('file.opened', { path: 'nobody/listens' });
    await expect(sandbox.runCommand('broken')).rejects.toThrow('TypeError: nope');
    await expect(sandbox.runCommand('missing')).rejects.toThrow('The plugin has no command "missing"');
    await sandbox.deactivate();
    expect(logged).toEqual(['log: saved app/a.ts', 'log: bye']);
    sandbox.dispose();
    await expect(sandbox.runCommand('broken')).rejects.toThrow('stopped');
  });

  it('a plugin that eats memory is stopped by its limit', async () => {
    const { sandboxHost } = host();
    const sandbox = await createSandbox(
      `plugin.onActivate((api) => {
        api.commands.register('hog', () => 'x'.repeat(10000000).length);
      });`,
      {},
      sandboxHost,
      { timeoutMs: 3000, memoryBytes: 4 * 1024 * 1024 },
    );
    await sandbox.activate();
    const error = await sandbox.runCommand('hog').catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(PluginError);
    expect((error as PluginError).message).toMatch(/out of memory/);
    sandbox.dispose();
  });

  it('measures: cold start, and a call to the host and back', async () => {
    const started = performance.now();
    const { sandboxHost } = host({ 'editor.getText': () => 'x' });
    const sandbox = await createSandbox(
      `plugin.onActivate((api) => {
        api.commands.register('ping', async () => { for (let i = 0; i < 100; i++) await api.editor.getText(); });
      });`,
      {},
      sandboxHost,
      FAST,
    );
    await sandbox.activate();
    const ready = performance.now();
    await sandbox.runCommand('ping');
    const roundTrips = performance.now() - ready;
    console.info(
      `QuickJS sandbox: ready in ${(ready - started).toFixed(1)} ms, ${(roundTrips / 100).toFixed(3)} ms per host call`,
    );
    sandbox.dispose();
    expect(roundTrips / 100).toBeLessThan(5);
    vi.restoreAllMocks();
  });
});
