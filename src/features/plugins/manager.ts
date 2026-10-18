import type { ContributedTheme } from '../../ui/theme';
import type { PluginHost, PluginLogEntry } from './host';
import type { InstalledPlugins } from './installed';
import { type LoadedPlugin, loadPlugins, type PluginSource } from './loader';
import { type Permission, parseManifest, type SettingValue } from './manifest';
import type { PluginPermissions } from './permissions';
import type { PluginFilesContent } from './registry';

/*
 * The plugins as SETTINGS → Plugins shows them (#49): every one found, on or
 * off, and the ones waiting for the user to approve what they ask for. It
 * starts a plugin only when it is on and all its permissions are approved.
 * It installs, updates and uninstalls the ones from the repository (#56).
 */

export type PluginEntryState = 'starting' | 'running' | 'failed' | 'off' | 'needs-approval';

export interface PluginEntry {
  plugin: LoadedPlugin;
  state: PluginEntryState;
  /** Why it failed. */
  error?: string;
  /** What it asks for that is not approved. */
  missing: Permission[];
}

export class PluginManager {
  private catalog: LoadedPlugin[] = [];
  private rejectedPlugins: { origin: string; errors: string[] }[] = [];
  private loaded = false;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly host: PluginHost,
    private readonly permissions: PluginPermissions,
    private readonly sources: () => PluginSource[],
    /** Where installed plugins are kept; without it, nothing can be installed. */
    private readonly installed?: InstalledPlugins,
  ) {
    host.subscribe(() => this.changed());
  }

  private changed() {
    this.listeners.forEach((listener) => listener());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Finds the plugins and starts the ones that are on and approved. */
  async load(): Promise<void> {
    await this.permissions.load();
    const { plugins, rejected } = await loadPlugins(this.sources());
    this.catalog = plugins;
    this.rejectedPlugins = rejected;
    for (const { origin, errors } of rejected) console.error(`Plugin ${origin} not loaded`, errors);
    this.changed();
    await Promise.all(plugins.filter((plugin) => this.startable(plugin)).map((plugin) => this.host.start(plugin)));
    this.loaded = true;
    this.changed();
  }

  /** The themes the running plugins bring (#52); null until the plugins have loaded. */
  themes(): ContributedTheme[] | null {
    if (!this.loaded) return null;
    const running = new Set(
      this.host
        .list()
        .filter((status) => status.state === 'running')
        .map((status) => status.manifest.id),
    );
    return this.catalog
      .filter((plugin) => running.has(plugin.manifest.id))
      .flatMap(({ manifest }) =>
        manifest.contributes.themes.map((theme) => ({
          id: `${manifest.id}.${theme.id}`,
          label: theme.label,
          plugin: manifest.name,
          base: theme.base,
          colors: theme.colors,
        })),
      );
  }

  private startable(plugin: LoadedPlugin) {
    return this.permissions.enabled(plugin.manifest.id) && this.permissions.missing(plugin.manifest).length === 0;
  }

  entries(): PluginEntry[] {
    const statuses = new Map(this.host.list().map((status) => [status.manifest.id, status]));
    return this.catalog.map((plugin) => {
      const { id } = plugin.manifest;
      const status = statuses.get(id);
      const missing = this.permissions.missing(plugin.manifest);
      const enabled = this.permissions.enabled(id);
      const state: PluginEntryState =
        status && status.state !== 'stopped'
          ? status.state
          : !enabled
            ? 'off'
            : missing.length > 0
              ? 'needs-approval'
              : 'off';
      return { plugin, state, missing, ...(status?.error && state === 'failed' && { error: status.error }) };
    });
  }

  rejected(): readonly { origin: string; errors: string[] }[] {
    return this.rejectedPlugins;
  }

  log(id: string): readonly PluginLogEntry[] {
    return this.host.log(id);
  }

  private find(id: string): LoadedPlugin {
    const plugin = this.catalog.find((candidate) => candidate.manifest.id === id);
    if (!plugin) throw new Error(`No plugin ${id}`);
    return plugin;
  }

  /** The user approved what plugin [id] asks for: it is on, and starts. */
  async approve(id: string): Promise<void> {
    const plugin = this.find(id);
    await this.permissions.approve(plugin.manifest);
    this.changed();
    await this.host.start(plugin);
  }

  /**
   * Installs [files], downloaded for plugin [expected].id, or updates it to
   * them: kept, approved for the permissions the user was shown
   * ([expected].permissions, and no more), and started.
   */
  async install(files: PluginFilesContent, expected: { id: string; permissions: readonly Permission[] }) {
    if (!this.installed) throw new Error('Plugins cannot be installed here');
    const parsed = parseManifest(files.manifest);
    if (!parsed.ok) throw new Error(`Not a plugin this Pepino runs: ${parsed.errors.join('; ')}`);
    const { manifest } = parsed;
    if (manifest.id !== expected.id) throw new Error(`The repository sent ${manifest.id}, not ${expected.id}`);
    const unseen = manifest.permissions.filter((permission) => !expected.permissions.includes(permission));
    if (unseen.length > 0)
      throw new Error(`${manifest.name} asks for more than the repository says: ${unseen.join(', ')}`);
    if (files.main.trim() === '' && manifest.contributes.commands.length > 0) {
      throw new Error(`${manifest.name} has commands but no main.js`);
    }
    if (this.catalog.some((plugin) => plugin.manifest.id === manifest.id && plugin.builtin)) {
      throw new Error(`${manifest.name} comes with Pepino`);
    }

    await this.installed.save(manifest.id, files);
    const plugin: LoadedPlugin = { manifest, main: files.main, origin: `installed:${manifest.id}`, builtin: false };
    this.catalog = [...this.catalog.filter((other) => other.manifest.id !== manifest.id), plugin];
    await this.permissions.approve(manifest);
    this.changed();
    await this.host.start(plugin);
  }

  /** Uninstalls plugin [id]: stopped (its commands, themes and listeners gone), its files, permissions and data deleted. */
  async uninstall(id: string): Promise<void> {
    const plugin = this.find(id);
    if (plugin.builtin || !this.installed)
      throw new Error(`${plugin.manifest.name} comes with Pepino: turn it off instead`);
    await this.host.remove(id);
    await this.installed.remove(id);
    await this.permissions.forget(id);
    this.catalog = this.catalog.filter((other) => other.manifest.id !== id);
    this.changed();
  }

  /** Plugin [id]'s settings (#57): the user's values, or the defaults. */
  settings(id: string): Record<string, SettingValue> {
    return this.permissions.settings(this.find(id).manifest);
  }

  /** Keeps the user's [values] for plugin [id]'s settings; a running plugin restarts once to read them. */
  async setSettings(id: string, values: Record<string, SettingValue>): Promise<void> {
    const plugin = this.find(id);
    await this.permissions.setSettings(plugin.manifest, values);
    this.changed();
    if (this.host.list().some((status) => status.manifest.id === id && status.state === 'running')) {
      await this.host.start(plugin);
    }
  }

  /** Takes back what plugin [id] was allowed (#57): it stops, and waits for the user to approve it again. */
  async revoke(id: string): Promise<void> {
    const plugin = this.find(id);
    await this.permissions.revoke(id);
    if (plugin.manifest.permissions.length > 0) await this.host.stop(id);
    this.changed();
  }

  /** Turns plugin [id] on (it starts, once approved) or off (it stops: its commands go). */
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const plugin = this.find(id);
    await this.permissions.setEnabled(id, enabled);
    this.changed();
    if (!enabled) await this.host.stop(id);
    else if (this.startable(plugin)) await this.host.start(plugin);
  }
}
