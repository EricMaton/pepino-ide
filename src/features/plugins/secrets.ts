import { registerPlugin } from '@capacitor/core';

/*
 * Each user's own keys for the plugins (#186): the AI assistant's Anthropic
 * key, say. On Android they are kept encrypted (the native `Secrets` plugin,
 * the Android Keystore), with the host each one belongs to, and nothing can
 * read one back: a request that needs it is made natively, over HTTPS to
 * that host only. Elsewhere (the web, tests) they are only in memory.
 */

/** A secret's name in the vault: one per plugin and key. */
export const secretName = (pluginId: string, key: string) => `plugin.${pluginId}.${key}`;

export interface SecretAnswer {
  status: number;
  headers: Record<string, string>;
  /** The whole answer; empty when it was streamed. */
  text: string;
}

export interface SecretRequest {
  /** The secret, and the header it goes in (after [prefix], such as "Bearer "). */
  name: string;
  header: string;
  prefix?: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface SecretVault {
  has(name: string): Promise<boolean>;
  /** Keeps [value] as secret [name], for requests to [host] only. */
  save(name: string, value: string, host: string): Promise<void>;
  delete(name: string): Promise<void>;
  /**
   * [request] with the secret in its header. With [onChunk], the answer
   * comes to it as it arrives (streaming), and [SecretAnswer.text] is empty.
   */
  request(request: SecretRequest, onChunk?: (text: string) => void, signal?: AbortSignal): Promise<SecretAnswer>;
  /** Signing in (#190): POSTs [body] to [url] on [host] and keeps its answer's [field] as secret [name]. */
  exchange(exchange: { name: string; host: string; url: string; body: string; field: string }): Promise<void>;
  /** Keeps the key on the clipboard as secret [name] (#190). */
  paste(name: string, host: string): Promise<void>;
  /** Opens an https link in the browser. */
  openUrl(url: string): Promise<void>;
}

interface SecretsPlugin {
  has(options: { name: string }): Promise<{ saved: boolean }>;
  save(options: { name: string; value: string; host: string }): Promise<void>;
  delete(options: { name: string }): Promise<void>;
  request(
    options: SecretRequest & { id: string; stream: boolean; headers: Record<string, string>; method: string },
  ): Promise<SecretAnswer>;
  cancel(options: { id: string }): Promise<void>;
  exchange(options: { name: string; host: string; url: string; body: string; field: string }): Promise<void>;
  paste(options: { name: string; host: string }): Promise<void>;
  openUrl(options: { url: string }): Promise<void>;
  addListener(
    event: 'chunk',
    listener: (chunk: { id: string; text: string }) => void,
  ): Promise<{ remove(): Promise<void> }>;
}

let nextRequest = 1;

export function nativeSecretVault(): SecretVault {
  const plugin = registerPlugin<SecretsPlugin>('Secrets');
  return {
    has: async (name) => (await plugin.has({ name })).saved,
    save: (name, value, host) => plugin.save({ name, value, host }),
    delete: (name) => plugin.delete({ name }),
    async request(request, onChunk, signal) {
      const id = `r${nextRequest++}`;
      const listener = onChunk
        ? await plugin.addListener('chunk', (chunk) => chunk.id === id && onChunk(chunk.text))
        : null;
      const cancel = () => void plugin.cancel({ id });
      signal?.addEventListener('abort', cancel);
      try {
        return await plugin.request({
          ...request,
          id,
          method: request.method ?? 'GET',
          headers: request.headers ?? {},
          stream: onChunk !== undefined,
        });
      } finally {
        signal?.removeEventListener('abort', cancel);
        await listener?.remove();
      }
    },
    exchange: (exchange) => plugin.exchange(exchange),
    paste: (name, host) => plugin.paste({ name, host }),
    openUrl: (url) => plugin.openUrl({ url }),
  };
}

/** Keys in memory, and requests with fetch: for the web (not kept) and tests. */
export function memorySecretVault(fetcher: typeof fetch = (...args) => fetch(...args)): SecretVault {
  const secrets = new Map<string, { value: string; host: string }>();
  return {
    has: async (name) => secrets.has(name),
    save: async (name, value, host) => void secrets.set(name, { value, host: host.toLowerCase() }),
    delete: async (name) => void secrets.delete(name),
    async request(request, onChunk, signal) {
      const secret = secrets.get(request.name);
      if (!secret) throw new Error('No key saved');
      const url = new URL(request.url);
      if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== secret.host) {
        throw new Error(`The key only goes to https://${secret.host}`);
      }
      const headers = Object.fromEntries(
        Object.entries(request.headers ?? {}).filter(([key]) => key.toLowerCase() !== request.header.toLowerCase()),
      );
      const response = await fetcher(url.toString(), {
        method: request.method ?? 'GET',
        headers: { ...headers, [request.header]: (request.prefix ?? '') + secret.value },
        body: request.body,
        signal,
      });
      const answer = { status: response.status, headers: Object.fromEntries(response.headers.entries()) };
      if (!onChunk || !response.ok || !response.body) return { ...answer, text: await response.text() };
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      for (let part = await reader.read(); !part.done; part = await reader.read()) onChunk(part.value);
      return { ...answer, text: '' };
    },
    async exchange({ name, host, url, body, field }) {
      if (new URL(url).hostname !== host) throw new Error(`Signing in only goes to https://${host}`);
      const response = await fetcher(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      const value = response.ok ? ((await response.json()) as Record<string, unknown>)[field] : undefined;
      if (typeof value !== 'string' || value === '')
        throw new Error(`Signing in did not work (${response.status}): try again`);
      secrets.set(name, { value, host: host.toLowerCase() });
    },
    async paste(name, host) {
      const value = (await navigator.clipboard.readText()).trim();
      if (!/^\S{20,400}$/.test(value)) throw new Error('The clipboard has no key: copy it first');
      secrets.set(name, { value, host: host.toLowerCase() });
    },
    async openUrl(url) {
      window.open(url, '_blank', 'noopener');
    },
  };
}
