import type { CommandDispatcher, CommandRegistry } from '../../core/commands';
import type { EventChannel } from '../../core/events';
import type { KeyValueStore } from '../../core/storage';
import type { ActiveEditor } from '../editor/activeEditor';
import { basename } from '../projects/paths';
import type { Workspace } from '../workspace/workspace';
import type { PluginConnection } from './connection';
import { secretName, type SecretVault } from './secrets';
import { OPENROUTER, pkce, type SignInProvider } from './signIn';
import { commandId, type LoadedPlugin, registerContributions } from './loader';
import type { Permission, PluginManifest, SettingValue } from './manifest';
import { DEFAULT_SANDBOX_OPTIONS, type SandboxHost, type SandboxOptions } from './sandbox';

/*
 * The plugins' host (#48, docs/plugin-api/v1-spec.md): starts each plugin in
 * its sandboxed worker, registers its commands (the palette shows them),
 * answers its api calls, and passes it the events it may listen to. Every
 * api call is checked here, on the host's side, against what the plugin may
 * do (#49): a call it may not make is refused and logged, never run.
 */

/** The topics plugins hear (api.editor.onSave / onOpen / onChange). */
type PluginEvents = {
  'file.saved': { path: string };
  'file.opened': { path: string };
  'editor.changed': { path: string };
};

const FORWARDED: (keyof PluginEvents)[] = ['file.saved', 'file.opened', 'editor.changed'];

/** Edits come a keystroke at a time: a plugin hears one change per pause. */
const CHANGE_DEBOUNCE_MS = 300;

export interface PluginLogEntry {
  time: number;
  level: 'log' | 'warn' | 'error';
  text: string;
}

/** How long a plugin's log gets before its oldest lines go. */
const LOG_LIMIT = 200;

export type PluginState = 'starting' | 'running' | 'failed' | 'stopped';

export interface QuickPickItem {
  label: string;
  detail?: string;
}

/** What a plugin asks the user (#53): the app shows it, and answers with what the user chose. */
export interface PluginPrompter {
  /** The index of the item chosen, or null when dismissed. */
  quickPick(request: { plugin: string; title?: string; items: QuickPickItem[] }): Promise<number | null>;
  /** The text entered, or null when dismissed. */
  input(request: { plugin: string; title?: string; placeholder?: string; value?: string }): Promise<string | null>;
  /**
   * A key of the user's own (#186), entered hidden: the text, true when it
   * was kept already ([paste]), null when dismissed.
   */
  secret(request: {
    plugin: string;
    label: string;
    host: string;
    help?: string;
    /** Keeps the clipboard's key, natively (#190). */
    paste: () => Promise<void>;
    /** Opens [help] in the browser. */
    openHelp?: () => Promise<void>;
  }): Promise<string | true | null>;
  /**
   * Signing in to [provider] (#190): the app shows it is waiting for the
   * browser, and calls [run], which ends when the key is kept. True when it
   * was; false when the user cancelled (which aborts [run]'s signal).
   */
  signIn(request: {
    plugin: string;
    label: string;
    provider: SignInProvider;
    run: (signal: AbortSignal) => Promise<void>;
  }): Promise<boolean>;
}

/** Where a plugin's api.storage is kept: one JSON object per plugin. */
export const pluginStorageKey = (id: string) => `pepino.plugin-data.${id}`;

/** How much a plugin may keep in api.storage, as JSON. */
export const STORAGE_LIMIT = 256 * 1024;

/** What api.fs gives at most (#187): files listed, a file read, matches found. */
export const FS_LIMITS = { files: 5000, readBytes: 1024 * 1024, found: 100, matches: 200 };

/** The most items a quick pick shows, and the longest text a prompt takes. */
const MAX_ITEMS = 1000;
const MAX_TEXT = 500;

export interface PluginStatus {
  manifest: PluginManifest;
  origin: string;
  builtin: boolean;
  state: PluginState;
  /** Why it failed to start, or stopped against its will. */
  error?: string;
}

export interface PluginHostDeps {
  registry: CommandRegistry;
  dispatcher: CommandDispatcher;
  events: EventChannel<PluginEvents>;
  activeEditor: ActiveEditor;
  /** A plugin's worker, answering its calls with [host]. */
  connect: (host: SandboxHost) => PluginConnection;
  /** Whether [plugin] may use [permission]: declared, and approved by the user (#49). */
  allowed?: (plugin: PluginManifest, permission: Permission) => boolean;
  /** Where api.storage persists (the app's preferences); only in memory without it. */
  storage?: KeyValueStore;
  /** The open project, for api.fs (#187): read, listed and searched, nothing outside it. */
  workspace?: Pick<Workspace, 'getState' | 'listFiles' | 'findFiles' | 'searchText' | 'readFile'>;
  /** Where the users' own keys are kept, and the requests that carry them go (#186). */
  secrets?: SecretVault;
  /** The code the provider's sign-in sends back to the app (#190). */
  waitForCode?: (provider: SignInProvider, signal: AbortSignal) => Promise<string>;
  /** [plugin]'s settings as the user set them (#57); each one's default without it. */
  settings?: (plugin: PluginManifest) => Record<string, SettingValue>;
  options?: SandboxOptions;
}

/** An api call the plugin may make, and the permission it needs, if any. */
type Handler = { permission?: Permission; run: (args: unknown[]) => unknown };

interface Running {
  plugin: LoadedPlugin;
  status: PluginStatus;
  connection: PluginConnection | null;
  log: PluginLogEntry[];
  stop: () => void;
  /** Its streams in progress (api.network.stream, #58), to cancel. */
  streams: Map<string, AbortController>;
}

export class PluginHost {
  private readonly plugins = new Map<string, Running>();
  private readonly listeners = new Set<() => void>();
  private notifier: (text: string) => void = (text) => console.info(text);
  private prompter: PluginPrompter | null = null;
  /** Where a plugin's messages to its pages go (the pages on screen, #185). */
  private pageSink: (pluginId: string, pageId: string, data: unknown) => void = () => undefined;
  /** Each plugin's api.storage, once read. */
  private readonly data = new Map<string, Promise<Record<string, unknown>>>();

  constructor(private readonly deps: PluginHostDeps) {}

  /** Where api.window.showMessage goes (the app's snackbar, once it is up). */
  setNotifier(notify: (text: string) => void) {
    this.notifier = notify;
  }

  /** Who shows api.window.showQuickPick / showInput (the app, once it is up); without one, they are dismissed. */
  setPrompter(prompter: PluginPrompter | null) {
    this.prompter = prompter;
  }

  /** Where api.pages.postMessage delivers: the app's plugin pages, once they are up. */
  setPageSink(sink: (pluginId: string, pageId: string, data: unknown) => void) {
    this.pageSink = sink;
  }

  /** Page [pageId] of plugin [pluginId] posted [data]: its plugin hears it (api.pages.onMessage). */
  async fromPage(pluginId: string, pageId: string, data: unknown): Promise<void> {
    const running = this.plugins.get(pluginId);
    if (!running || running.status.state !== 'running' || !running.connection) return;
    await running.connection
      .emit(`page.message:${pageId}`, data)
      .catch((failure: unknown) => this.record(running, 'error', `page ${pageId}: ${messageOf(failure)}`));
  }

  /** Plugin [id]'s api.storage. */
  private storageOf(id: string): Promise<Record<string, unknown>> {
    let found = this.data.get(id);
    if (!found) {
      const storage = this.deps.storage;
      found = (storage ? storage.get(pluginStorageKey(id)) : Promise.resolve(null)).then((raw) => {
        try {
          const value: unknown = raw ? JSON.parse(raw) : {};
          return typeof value === 'object' && value !== null && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : {};
        } catch {
          return {};
        }
      });
      this.data.set(id, found);
    }
    return found;
  }

  /** Puts [key] in plugin [id]'s storage ([value] undefined: takes it out), within the limit. */
  private async store(id: string, key: string, value: unknown) {
    const data = await this.storageOf(id);
    const before = data[key];
    if (value === undefined) delete data[key];
    else data[key] = value;
    const raw = JSON.stringify(data);
    if (raw.length > STORAGE_LIMIT) {
      if (before === undefined) delete data[key];
      else data[key] = before;
      throw new Error(`Storage is full: a plugin may keep ${STORAGE_LIMIT / 1024} KB`);
    }
    await this.deps.storage?.set(pluginStorageKey(id), raw);
  }

  /** Every plugin started (or that failed to), in the order they were. */
  list(): PluginStatus[] {
    return [...this.plugins.values()].map((running) => running.status);
  }

  log(id: string): readonly PluginLogEntry[] {
    return this.plugins.get(id)?.log ?? [];
  }

  /** Called whenever a plugin starts, stops or fails, or logs. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed() {
    this.listeners.forEach((listener) => listener());
  }

  private record(running: Running, level: PluginLogEntry['level'], text: string) {
    running.log.push({ time: Date.now(), level, text });
    if (running.log.length > LOG_LIMIT) running.log.splice(0, running.log.length - LOG_LIMIT);
    if (level === 'error') console.error(`[${running.plugin.manifest.id}] ${text}`);
    this.changed();
  }

  /** Starts [plugin]: its worker, main.js and onActivate; then its commands and events. */
  async start(plugin: LoadedPlugin): Promise<void> {
    const { manifest } = plugin;
    await this.stop(manifest.id);
    const disposers: (() => void)[] = [];
    const running: Running = {
      plugin,
      status: { manifest, origin: plugin.origin, builtin: plugin.builtin, state: 'starting' },
      connection: null,
      log: [],
      stop: () => disposers.splice(0).forEach((dispose) => dispose()),
      streams: new Map(),
    };
    // Stopped, its streams stop too
    disposers.push(() => running.streams.forEach((stream) => stream.abort()));
    this.plugins.set(manifest.id, running);
    this.changed();

    // Nothing to run (it only brings themes, say): no worker
    if (plugin.main.trim() === '') {
      running.status = { ...running.status, state: 'running' };
      this.changed();
      return;
    }

    const handlers = this.handlers(manifest, running);
    const connection = this.deps.connect({
      call: async (method, args) => {
        const handler = handlers[method];
        if (!handler) throw new Error(`api has no ${method}`);
        if (handler.permission && !this.may(manifest, handler.permission)) {
          this.record(running, 'error', `Blocked ${method}: the plugin may not use ${handler.permission}`);
          throw new Error(`Not allowed: ${handler.permission}`);
        }
        return handler.run(args);
      },
      log: (level, text) => this.record(running, level, text),
      // Past the sandbox's deadline, the worker itself stopped answering: it is gone (#50)
      unresponsive: () => {
        running.stop();
        const error = 'It stopped responding, and Pepino stopped it';
        running.status = { ...running.status, state: 'failed', error };
        this.record(running, 'error', error);
        this.notifier(`${manifest.name}: ${error}`);
      },
    });
    running.connection = connection;
    disposers.push(() => connection.terminate());

    try {
      await connection.init(
        plugin.main,
        this.deps.settings?.(manifest) ?? settingsOf(manifest),
        this.deps.options ?? DEFAULT_SANDBOX_OPTIONS,
        manifest.permissions.filter((permission) => this.may(manifest, permission)),
      );
      await connection.activate();
    } catch (failure) {
      running.stop();
      running.status = { ...running.status, state: 'failed', error: messageOf(failure) };
      this.record(running, 'error', `Could not start: ${messageOf(failure)}`);
      return;
    }

    disposers.push(
      registerContributions(manifest, this.deps.registry, async (command) => {
        try {
          await connection.runCommand(command);
        } catch (failure) {
          this.record(running, 'error', `${command}: ${messageOf(failure)}`);
          throw failure;
        }
      }),
    );
    for (const topic of FORWARDED) disposers.push(this.forward(running, topic));
    running.status = { ...running.status, state: 'running' };
    this.changed();
  }

  /** Stops plugin [id]: onDeactivate if it answers, its commands and listeners gone, its worker ended. */
  async stop(id: string): Promise<void> {
    const running = this.plugins.get(id);
    if (!running || running.status.state === 'stopped') return;
    if (running.status.state === 'running') {
      await running.connection?.deactivate().catch(() => undefined);
    }
    running.stop();
    running.status = { ...running.status, state: 'stopped' };
    this.changed();
  }

  /** Whether the user saved [manifest]'s secret [key] (#186). */
  async hasSecret(manifest: PluginManifest, key: string): Promise<boolean> {
    return (await this.deps.secrets?.has(secretName(manifest.id, key))) ?? false;
  }

  /** Keeps [value] as [manifest]'s secret [key], for its host only. */
  async saveSecret(manifest: PluginManifest, key: string, value: string): Promise<void> {
    const secret = manifest.secrets.find((declared) => declared.key === key);
    if (!secret || !this.deps.secrets) throw new Error(`The plugin has no secret "${key}"`);
    await this.deps.secrets.save(secretName(manifest.id, key), value.trim(), secret.host);
    this.changed();
  }

  /** Keeps the key on the clipboard as [manifest]'s secret [key] (#190): it never goes through here. */
  async pasteSecret(manifest: PluginManifest, key: string): Promise<void> {
    const secret = manifest.secrets.find((declared) => declared.key === key);
    if (!secret || !this.deps.secrets) throw new Error(`The plugin has no secret "${key}"`);
    await this.deps.secrets.paste(secretName(manifest.id, key), secret.host);
    this.changed();
  }

  /** Opens where to get [manifest]'s secret [key]. */
  async openSecretHelp(manifest: PluginManifest, key: string): Promise<void> {
    const help = manifest.secrets.find((declared) => declared.key === key)?.help;
    if (help && this.deps.secrets) await this.deps.secrets.openUrl(help);
  }

  /** Signs in to the provider of [manifest]'s secret [key] and keeps the key it gives (#190). */
  async signInSecret(manifest: PluginManifest, key: string): Promise<boolean> {
    const secret = manifest.secrets.find((declared) => declared.key === key);
    const { secrets, waitForCode } = this.deps;
    if (!secret?.signIn) throw new Error(`"${key}" is not signed in to`);
    if (!secrets || !waitForCode || !this.prompter) throw new Error('Signing in works in the app on a phone');
    const saved = await this.prompter.signIn({
      plugin: manifest.name,
      label: secret.label,
      provider: secret.signIn,
      run: async (signal) => {
        const { verifier, challenge } = await pkce();
        const code = waitForCode(secret.signIn!, signal);
        await secrets.openUrl(OPENROUTER.authorize(challenge));
        await secrets.exchange({
          name: secretName(manifest.id, key),
          host: secret.host,
          url: OPENROUTER.exchange,
          body: OPENROUTER.body(await code, verifier),
          field: OPENROUTER.field,
        });
      },
    });
    this.changed();
    return saved;
  }

  async forgetSecret(manifest: PluginManifest, key: string): Promise<void> {
    await this.deps.secrets?.delete(secretName(manifest.id, key));
    this.changed();
  }

  /** Plugin [id] is uninstalled (#56): stopped, and its status, api.storage and secrets gone. */
  async remove(id: string): Promise<void> {
    const manifest = this.plugins.get(id)?.plugin.manifest;
    if (manifest) for (const { key } of manifest.secrets) await this.forgetSecret(manifest, key);
    await this.stop(id);
    this.plugins.delete(id);
    this.data.delete(id);
    await this.deps.storage?.set(pluginStorageKey(id), '{}');
    this.changed();
  }

  /** Stops every plugin. */
  async stopAll(): Promise<void> {
    await Promise.all([...this.plugins.keys()].map((id) => this.stop(id)));
  }

  private may(manifest: PluginManifest, permission: Permission): boolean {
    if (!manifest.permissions.includes(permission)) return false;
    return this.deps.allowed ? this.deps.allowed(manifest, permission) : true;
  }

  /** [manifest]'s secret for [url]'s host, when the user saved it: the requests there carry it. */
  private async secretFor(manifest: PluginManifest, url: string) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'https:') return null;
    const secret = manifest.secrets.find((declared) => declared.host === parsed.hostname.toLowerCase());
    return secret && (await this.hasSecret(manifest, secret.key)) ? secret : null;
  }

  /** The open project, as api.fs sees it: its root, and its paths made relative to it and back. */
  private project() {
    const workspace = this.deps.workspace;
    const root = workspace?.getState().root ?? '';
    if (!workspace || root === '') throw new Error('No project is open');
    return {
      workspace,
      root,
      relative: (path: string) => path.slice(root.length + 1),
      absolute: (path: string) => {
        const parts = path
          .replace(/\\/g, '/')
          .split('/')
          .filter((part) => part !== '' && part !== '.');
        if (path.startsWith('/') || parts.includes('..')) throw new Error(`Outside the project: ${path}`);
        return [root, ...parts].join('/');
      },
    };
  }

  /**
   * A plugin's request: through the vault with its key when [url] is a
   * saved secret's host (#186), by the WebView's fetch otherwise. With
   * [onChunk], the answer comes to it as it arrives.
   */
  private async send(
    manifest: PluginManifest,
    url: string,
    init: unknown,
    onChunk?: (text: string) => void,
    signal?: AbortSignal,
  ) {
    const options = (init ?? {}) as { method?: string; headers?: Record<string, string>; body?: string };
    const secret = await this.secretFor(manifest, url);
    if (secret && this.deps.secrets) {
      return this.deps.secrets.request(
        {
          name: secretName(manifest.id, secret.key),
          header: secret.header,
          prefix: secret.prefix,
          url,
          method: options.method ?? 'GET',
          headers: options.headers,
          body: options.body,
        },
        onChunk,
        signal,
      );
    }
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: options.body,
      signal,
    });
    const answer = { status: response.status, headers: Object.fromEntries(response.headers.entries()) };
    if (!onChunk || !response.ok || !response.body) return { ...answer, text: await response.text() };
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    for (let part = await reader.read(); !part.done; part = await reader.read()) onChunk(part.value);
    return { ...answer, text: '' };
  }

  /** What [manifest]'s plugin can call, as the spec's api names it. */
  private handlers(manifest: PluginManifest, running: Running): Record<string, Handler> {
    const declared = (key: string) => {
      const secret = manifest.secrets.find((candidate) => candidate.key === key);
      if (!secret) throw new Error(`The plugin has no secret "${key}" in its manifest`);
      return secret;
    };
    const editor = () => {
      const current = this.deps.activeEditor.current();
      if (!current) throw new Error('No file is open in the editor');
      return current;
    };
    return {
      'editor.getPath': { permission: 'editor.read', run: () => editor().path },
      'editor.getSelection': { permission: 'editor.read', run: () => editor().getSelection() },
      'editor.insert': {
        permission: 'editor.write',
        run: ([text]) => {
          editor().insert(String(text));
        },
      },
      'editor.insertSnippet': {
        permission: 'editor.write',
        run: ([body]) => {
          editor().insertSnippet(String(body));
        },
      },
      'editor.getText': { permission: 'editor.read', run: () => editor().getText() },
      'editor.setText': {
        permission: 'editor.write',
        run: ([text]) => {
          editor().setText(String(text));
        },
      },
      'commands.execute': {
        // Its own commands by their short id; anything else by the app's id
        run: async ([id]) => {
          const own = commandId(manifest, String(id));
          await this.deps.dispatcher.execute(this.deps.registry.find(own) ? own : String(id));
        },
      },
      'network.fetch': {
        permission: 'network',
        // To a host of one of its secrets, saved: the request goes with it, through the vault (#186)
        run: ([url, init]) => this.send(manifest, String(url), init),
      },
      'network.stream': {
        permission: 'network',
        // The answer as it arrives, each part to the plugin's listener in order, all of it before this resolves
        run: async ([url, init, id]) => {
          const stream = String(id);
          const controller = new AbortController();
          running.streams.set(stream, controller);
          let delivered: Promise<unknown> = Promise.resolve();
          const onChunk = (text: string) => {
            delivered = delivered.then(() => running.connection?.emit(`network.chunk:${stream}`, text));
          };
          try {
            const answer = await this.send(manifest, String(url), init, onChunk, controller.signal);
            await delivered;
            return answer;
          } catch (failure) {
            if (controller.signal.aborted) throw new Error('Cancelled', { cause: failure });
            throw failure;
          } finally {
            running.streams.delete(stream);
          }
        },
      },
      'network.cancel': {
        permission: 'network',
        run: ([id]) => {
          running.streams.get(String(id))?.abort();
        },
      },
      'window.showMessage': {
        run: ([text]) => {
          this.notifier(`${manifest.name}: ${String(text)}`);
        },
      },
      'pages.postMessage': {
        run: ([pageId, data]) => {
          const page = String(pageId);
          if (!manifest.contributes.pages.some((declared) => declared.id === page)) {
            throw new Error(`The plugin has no page "${page}"`);
          }
          this.pageSink(manifest.id, page, data ?? null);
        },
      },
      'window.showQuickPick': {
        run: async ([items, options]) => {
          if (!Array.isArray(items)) throw new Error('showQuickPick: give a list of items');
          const listed = items.slice(0, MAX_ITEMS).map((item) => {
            const { label, detail } = (item ?? {}) as { label?: unknown; detail?: unknown };
            return {
              label: text(label),
              ...(detail !== undefined && detail !== null && { detail: text(detail) }),
            };
          });
          const { title } = (options ?? {}) as { title?: unknown };
          const chosen = await (this.prompter?.quickPick({
            plugin: manifest.name,
            ...(title !== undefined && { title: text(title) }),
            items: listed,
          }) ?? null);
          return chosen !== null && chosen >= 0 && chosen < listed.length ? chosen : null;
        },
      },
      'window.showInput': {
        run: async ([options]) => {
          const { title, placeholder, value } = (options ?? {}) as Record<string, unknown>;
          return (
            (await this.prompter?.input({
              plugin: manifest.name,
              ...(title !== undefined && { title: text(title) }),
              ...(placeholder !== undefined && { placeholder: text(placeholder) }),
              ...(value !== undefined && { value: String(value).slice(0, STORAGE_LIMIT) }),
            })) ?? null
          );
        },
      },
      'secrets.has': { run: ([key]) => this.hasSecret(manifest, declared(String(key)).key) },
      'secrets.ask': {
        run: async ([key]) => {
          const secret = declared(String(key));
          const value = await this.prompter?.secret({
            plugin: manifest.name,
            label: secret.label,
            host: secret.host,
            ...(secret.help && { help: secret.help, openHelp: () => this.openSecretHelp(manifest, secret.key) }),
            paste: () => this.pasteSecret(manifest, secret.key),
          });
          if (value === true) return true;
          if (!value || value.trim() === '') return false;
          await this.saveSecret(manifest, secret.key, value);
          return true;
        },
      },
      'secrets.signIn': { run: ([key]) => this.signInSecret(manifest, declared(String(key)).key) },
      'secrets.forget': {
        run: async ([key]) => {
          await this.forgetSecret(manifest, declared(String(key)).key);
        },
      },
      'fs.root': {
        permission: 'fs.read',
        run: () => {
          const root = this.deps.workspace?.getState().root ?? '';
          return root === '' ? null : basename(root);
        },
      },
      'fs.list': {
        permission: 'fs.read',
        run: async () => {
          const { workspace, relative } = this.project();
          return (await workspace.listFiles())
            .slice(0, FS_LIMITS.files)
            .map((file) => ({ path: relative(file.path), size: file.sizeBytes }));
        },
      },
      'fs.read': {
        permission: 'fs.read',
        run: async ([path]) => {
          const { workspace, absolute } = this.project();
          const text = await workspace.readFile(absolute(String(path)));
          if (text.includes('\u0000')) throw new Error(`Not a text file: ${String(path)}`);
          if (text.length > FS_LIMITS.readBytes) {
            throw new Error(`Too big to read: ${String(path)} (over ${FS_LIMITS.readBytes / 1024} KB)`);
          }
          return text;
        },
      },
      'fs.find': {
        permission: 'fs.read',
        run: async ([query, limit]) => {
          const { workspace, relative } = this.project();
          const most = Math.min(Number(limit) || 20, FS_LIMITS.found);
          return (await workspace.findFiles(String(query), most)).map(relative);
        },
      },
      'fs.search': {
        permission: 'fs.read',
        run: async ([query, options]) => {
          const { workspace, relative } = this.project();
          const { limit, caseSensitive } = (options ?? {}) as { limit?: unknown; caseSensitive?: unknown };
          const matches = await workspace.searchText(String(query), {
            limit: Math.min(Number(limit) || 50, FS_LIMITS.matches),
            caseSensitive: caseSensitive === true,
          });
          return matches.map((match) => ({ ...match, path: relative(match.path) }));
        },
      },
      'storage.get': { run: async ([key]) => (await this.storageOf(manifest.id))[String(key)] ?? null },
      'storage.set': {
        run: async ([key, value]) => {
          await this.store(manifest.id, String(key), value ?? undefined);
        },
      },
      'storage.delete': {
        run: async ([key]) => {
          await this.store(manifest.id, String(key), undefined);
        },
      },
    };
  }

  /** Passes [topic] on to [running]'s plugin; edits only once they pause. */
  private forward(running: Running, topic: keyof PluginEvents): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const send = (payload: unknown) =>
      running.connection
        ?.emit(topic, payload)
        .catch((failure: unknown) => this.record(running, 'error', `${topic}: ${messageOf(failure)}`));
    const stop = this.deps.events.subscribe(topic, (payload) => {
      if (topic !== 'editor.changed') {
        void send(payload);
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => void send(payload), CHANGE_DEBOUNCE_MS);
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }
}

/** A plugin's settings with nobody's values: each one's default. */
function settingsOf(manifest: PluginManifest): Record<string, SettingValue> {
  return Object.fromEntries(manifest.contributes.settings.map((setting) => [setting.key, setting.default]));
}

/** A plugin's text for the app's UI: a string, not too long. */
const text = (value: unknown) => String(value).slice(0, MAX_TEXT);

function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}
