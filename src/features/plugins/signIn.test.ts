import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandDispatcher, CommandRegistry } from '../../core/commands';
import { EventBus } from '../../core/events';
import { createActiveEditor } from '../editor/activeEditor';
import { PluginHost, type PluginPrompter } from './host';
import { parseManifest } from './manifest';
import { memorySecretVault, secretName } from './secrets';
import { CALLBACK_URL, codeFrom, pkce } from './signIn';

/*
 * Signing in to an AI account (#190): the browser's sign-in comes back with
 * a code, exchanged for the user's own key with PKCE, and kept like any
 * other secret; a pasted key goes straight from the clipboard to the vault.
 */
afterEach(() => vi.unstubAllGlobals());

const MANIFEST = {
  id: 'dev.test.ai',
  name: 'AI',
  version: '1.0.0',
  apiVersion: '1',
  permissions: ['network'],
  networkJustification: 'It talks to the model',
  secrets: [
    {
      key: 'openrouter',
      label: 'OpenRouter account',
      host: 'openrouter.ai',
      header: 'authorization',
      prefix: 'Bearer ',
      signIn: 'openrouter',
    },
    { key: 'anthropic', label: 'Anthropic API key', host: 'api.anthropic.com', header: 'x-api-key' },
  ],
};

function setUp() {
  const parsed = parseManifest(JSON.stringify(MANIFEST));
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  const sent: { url: string; headers: Record<string, string>; body?: string }[] = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({
      url: String(url),
      headers: { ...(init?.headers as Record<string, string>) },
      body: init?.body as string,
    });
    return String(url).endsWith('/auth/keys')
      ? new Response(JSON.stringify({ key: 'sk-or-mine' }))
      : new Response('{"ok":true}');
  });
  const vault = {
    ...memorySecretVault(fetcher as unknown as typeof fetch),
    openUrl: vi.fn(async (_url: string) => undefined),
  };
  const waitForCode = vi.fn(async () => 'c0de');
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
    connect: vi.fn(),
    secrets: vault,
    waitForCode,
  });
  // The app's dialog: it runs the sign-in at once
  const signIn = vi.fn<PluginPrompter['signIn']>(async (request) => {
    await request.run(new AbortController().signal);
    return true;
  });
  host.setPrompter({ quickPick: async () => null, input: async () => null, secret: async () => null, signIn });
  return { host, manifest: parsed.manifest, vault, sent, waitForCode, signIn };
}

describe('signing in to an AI account (#190)', () => {
  it('makes a PKCE pair: the challenge is the verifier’s SHA-256, base64url', async () => {
    const { verifier, challenge } = await pkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
  });

  it('reads the code from the link back to the app, for its provider only', () => {
    expect(codeFrom('pepino://auth/openrouter?code=abc123', 'openrouter')).toBe('abc123');
    expect(codeFrom('pepino://auth/other?code=abc123', 'openrouter')).toBeNull();
    expect(codeFrom('https://evil.example/?code=abc123', 'openrouter')).toBeNull();
  });

  it('a secret may be signed in to: only OpenRouter, on its own host', () => {
    expect(parseManifest(JSON.stringify(MANIFEST)).ok).toBe(true);
    const wrong = parseManifest(
      JSON.stringify({ ...MANIFEST, secrets: [{ ...MANIFEST.secrets[0], host: 'evil.example.com' }] }),
    );
    expect(wrong).toEqual({
      ok: false,
      errors: ['secrets[0].signIn: one of openrouter, with its host (openrouter.ai)'],
    });
  });

  it('opens the sign-in, exchanges the code with its verifier, and the key then goes as a Bearer token', async () => {
    const { host, manifest, vault, sent, waitForCode, signIn } = setUp();
    expect(await host.signInSecret(manifest, 'openrouter')).toBe(true);

    expect(signIn).toHaveBeenCalledWith(expect.objectContaining({ plugin: 'AI', provider: 'openrouter' }));
    expect(waitForCode).toHaveBeenCalledWith('openrouter', expect.any(AbortSignal));
    const opened = new URL(vault.openUrl.mock.calls[0][0]);
    expect(`${opened.origin}${opened.pathname}`).toBe('https://openrouter.ai/auth');
    expect(opened.searchParams.get('callback_url')).toBe(CALLBACK_URL);
    expect(opened.searchParams.get('code_challenge_method')).toBe('S256');

    const exchange = JSON.parse(sent[0].body!);
    expect(sent[0].url).toBe('https://openrouter.ai/api/v1/auth/keys');
    expect(exchange.code).toBe('c0de');
    expect(createHash('sha256').update(exchange.code_verifier).digest('base64url')).toBe(
      opened.searchParams.get('code_challenge'),
    );
    expect(await vault.has(secretName('dev.test.ai', 'openrouter'))).toBe(true);

    // The key is sent with its prefix, as the header OpenRouter expects
    await vault.request({
      name: secretName('dev.test.ai', 'openrouter'),
      header: 'authorization',
      prefix: 'Bearer ',
      url: 'https://openrouter.ai/api/v1/messages',
    });
    expect(sent[1].headers).toEqual({ authorization: 'Bearer sk-or-mine' });
  });

  it('cancelled in the dialog, nothing is kept', async () => {
    const { host, manifest, vault, signIn } = setUp();
    signIn.mockResolvedValueOnce(false);
    expect(await host.signInSecret(manifest, 'openrouter')).toBe(false);
    expect(await vault.has(secretName('dev.test.ai', 'openrouter'))).toBe(false);
  });

  it('a key pasted goes from the clipboard to the vault, if it looks like one', async () => {
    const { host, manifest, vault } = setUp();
    vi.stubGlobal('navigator', { clipboard: { readText: async () => 'hello' } });
    await expect(host.pasteSecret(manifest, 'anthropic')).rejects.toThrow('The clipboard has no key: copy it first');
    vi.stubGlobal('navigator', { clipboard: { readText: async () => '  sk-ant-api03-0123456789abcdef  ' } });
    await host.pasteSecret(manifest, 'anthropic');
    expect(await vault.has(secretName('dev.test.ai', 'anthropic'))).toBe(true);
  });
});
