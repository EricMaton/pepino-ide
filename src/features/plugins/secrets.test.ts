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
import { memorySecretVault, secretName } from './secrets';

/*
 * Each user's own keys (#186): asked for by the app, kept by it, sent only
 * to their host in their header; the plugin never sees one.
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

const MANIFEST = {
  id: 'dev.test.ai',
  name: 'AI',
  version: '1.0.0',
  apiVersion: '1',
  permissions: ['network'],
  networkJustification: 'It talks to the model',
  secrets: [
    {
      key: 'apiKey',
      label: 'Example API key',
      host: 'api.example.com',
      header: 'x-api-key',
      help: 'https://example.com/keys',
    },
  ],
  contributes: { commands: [{ id: 'run', title: 'Run' }] },
};

function setUp(main: string) {
  const parsed = parseManifest(JSON.stringify(MANIFEST));
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  const plugin: LoadedPlugin = { manifest: parsed.manifest, main, assets: {}, origin: 'test', builtin: false };
  const sent: { url: string; headers: Record<string, string> }[] = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) } });
    return new Response('{"ok":true}', { status: 200 });
  });
  // Requests without a key go by the WebView's fetch
  vi.stubGlobal('fetch', fetcher);
  const vault = memorySecretVault(fetcher as typeof fetch);
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
  const secret = vi.fn(async () => 'sk-mine' as string | null);
  host.setPrompter({ quickPick: async () => null, input: async () => null, secret });
  return { host, plugin, dispatcher, notify, secret, sent, vault };
}

describe('plugin secrets (#186)', () => {
  it('a manifest declares them: a label, the one host and the header; they need the network', () => {
    expect(parseManifest(JSON.stringify(MANIFEST))).toMatchObject({
      ok: true,
      manifest: { secrets: [{ key: 'apiKey', host: 'api.example.com', header: 'x-api-key' }] },
    });
    expect(
      parseManifest(
        JSON.stringify({
          ...MANIFEST,
          permissions: [],
          networkJustification: undefined,
          secrets: [{ ...MANIFEST.secrets[0] }, { key: 'b', label: 'B', host: 'https://x.com/', header: 'h' }],
        }),
      ),
    ).toEqual({
      ok: false,
      errors: [
        'secrets[1]: { key, label, host (a domain), header, help? (https URL) }',
        'secrets: the plugin needs the network permission to use them',
      ],
    });
  });

  it('the app asks the user, keeps it, and sends it only to its host: the plugin never sees it', async () => {
    const { host, plugin, dispatcher, notify, secret, sent, vault } = setUp(
      `plugin.onActivate((api) => api.commands.register('run', async () => {
        const before = await api.secrets.has('apiKey');
        const saved = await api.secrets.ask('apiKey');
        const answer = await api.network.fetch('https://api.example.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': 'my guess', 'content-type': 'application/json' },
          body: '{}',
        });
        await api.network.fetch('https://elsewhere.example.org/');
        await api.window.showMessage(JSON.stringify({ before, saved, now: await api.secrets.has('apiKey'), answer }));
      }));`,
    );
    await host.start(plugin);
    await dispatcher.execute('dev.test.ai.run');

    expect(secret).toHaveBeenCalledWith({
      plugin: 'AI',
      label: 'Example API key',
      host: 'api.example.com',
      help: 'https://example.com/keys',
    });
    expect(sent).toEqual([
      {
        url: 'https://api.example.com/v1/messages',
        headers: { 'content-type': 'application/json', 'x-api-key': 'sk-mine' },
      },
      { url: 'https://elsewhere.example.org/', headers: {} },
    ]);
    const shown = JSON.parse(notify.mock.calls[0][0].slice('AI: '.length));
    expect(shown).toMatchObject({
      before: false,
      saved: true,
      now: true,
      answer: { status: 200, text: '{"ok":true}' },
    });
    expect(JSON.stringify(shown)).not.toContain('sk-mine');
    expect(await vault.has(secretName('dev.test.ai', 'apiKey'))).toBe(true);
  });

  it('dismissed, nothing is kept; forgotten or uninstalled, it is gone', async () => {
    const { host, plugin, dispatcher, notify, secret, vault } = setUp(
      `plugin.onActivate((api) => {
        api.commands.register('run', async () => api.window.showMessage(String(await api.secrets.ask('apiKey'))));
      });`,
    );
    secret.mockResolvedValueOnce(null);
    await host.start(plugin);
    await dispatcher.execute('dev.test.ai.run');
    expect(notify).toHaveBeenLastCalledWith('AI: false');
    expect(await host.hasSecret(plugin.manifest, 'apiKey')).toBe(false);

    await host.saveSecret(plugin.manifest, 'apiKey', ' sk-2 ');
    expect(await host.hasSecret(plugin.manifest, 'apiKey')).toBe(true);
    await host.forgetSecret(plugin.manifest, 'apiKey');
    expect(await host.hasSecret(plugin.manifest, 'apiKey')).toBe(false);

    await host.saveSecret(plugin.manifest, 'apiKey', 'sk-3');
    await host.remove('dev.test.ai');
    expect(await vault.has(secretName('dev.test.ai', 'apiKey'))).toBe(false);
  });

  it('a plugin cannot ask for a key it did not declare', async () => {
    const { host, plugin, dispatcher } = setUp(
      `plugin.onActivate((api) => api.commands.register('run', () => api.secrets.ask('other')));`,
    );
    await host.start(plugin);
    await expect(dispatcher.execute('dev.test.ai.run')).rejects.toThrow(
      'The plugin has no secret "other" in its manifest',
    );
  });

  it('the vault sends a key only over HTTPS to its host, and can stream the answer', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: one\n'));
              controller.enqueue(new TextEncoder().encode('data: two\n'));
              controller.close();
            },
          }),
        ),
    );
    const vault = memorySecretVault(fetcher as unknown as typeof fetch);
    await vault.save('k', 'sk', 'api.example.com');
    const request = { name: 'k', header: 'x-api-key' };
    await expect(vault.request({ ...request, url: 'https://evil.example.net/' })).rejects.toThrow(
      'The key only goes to https://api.example.com',
    );
    await expect(vault.request({ ...request, url: 'http://api.example.com/' })).rejects.toThrow('only goes to');

    const chunks: string[] = [];
    const answer = await vault.request({ ...request, url: 'https://api.example.com/v1' }, (text) => chunks.push(text));
    expect(chunks.join('')).toBe('data: one\ndata: two\n');
    expect(answer).toMatchObject({ status: 200, text: '' });
  });
});
