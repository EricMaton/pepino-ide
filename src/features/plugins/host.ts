import type { CommandDispatcher, CommandRegistry } from '../../core/commands';
import type { EventChannel } from '../../core/events';
import type { ActiveEditor } from '../editor/activeEditor';
import type { PluginConnection } from './connection';
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
}

export class PluginHost {
  private readonly plugins = new Map<string, Running>();
  private readonly listeners = new Set<() => void>();
  private notifier: (text: string) => void = (text) => console.info(text);

  constructor(private readonly deps: PluginHostDeps) {}

  /** Where api.window.showMessage goes (the app's snackbar, once it is up). */
  setNotifier(notify: (text: string) => void) {
    this.notifier = notify;
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
    };
    this.plugins.set(manifest.id, running);
    this.changed();

    const handlers = this.handlers(manifest);
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
    });
    running.connection = connection;
    disposers.push(() => connection.terminate());

    try {
      await connection.init(plugin.main, settingsOf(manifest), this.deps.options ?? DEFAULT_SANDBOX_OPTIONS);
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

  /** Stops every plugin. */
  async stopAll(): Promise<void> {
    await Promise.all([...this.plugins.keys()].map((id) => this.stop(id)));
  }

  private may(manifest: PluginManifest, permission: Permission): boolean {
    if (!manifest.permissions.includes(permission)) return false;
    return this.deps.allowed ? this.deps.allowed(manifest, permission) : true;
  }

  /** What [manifest]'s plugin can call, as the spec's api names it. */
  private handlers(manifest: PluginManifest): Record<string, Handler> {
    const editor = () => {
      const current = this.deps.activeEditor.current();
      if (!current) throw new Error('No file is open in the editor');
      return current;
    };
    return {
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
      'window.showMessage': {
        run: ([text]) => {
          this.notifier(`${manifest.name}: ${String(text)}`);
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

/** The plugin's settings as it starts: each one's default (the user's own values come with #57). */
function settingsOf(manifest: PluginManifest): Record<string, SettingValue> {
  return Object.fromEntries(manifest.contributes.settings.map((setting) => [setting.key, setting.default]));
}

function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}
