import type { Command, CommandRegistry } from '../../core/commands';
import { type PluginManifest, parseManifest } from './manifest';

/*
 * Plugins as the app finds them (#46): a source lists packages (plugin.json
 * and main.js), each manifest is checked, and what a plugin contributes is
 * registered with disposers, so turning it off or uninstalling takes it all
 * away again without a restart. The plugins that come with Pepino are in
 * src/plugins/<name>/; installing more is Sprint 7's (#56).
 */

/** A plugin as stored: its plugin.json and main.js, and where it came from. */
export interface PluginPackage {
  /** "builtin:hello-world", or an install's folder. */
  origin: string;
  manifest: string;
  main: string;
  /** Comes with Pepino: it can be turned off, not uninstalled. */
  builtin: boolean;
}

export interface PluginSource {
  list(): Promise<PluginPackage[]>;
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  main: string;
  origin: string;
  builtin: boolean;
}

export interface LoadResult {
  plugins: LoadedPlugin[];
  /** Packages not loaded, and why. */
  rejected: { origin: string; errors: string[] }[];
}

/** Every package of [sources] whose manifest holds; the first of two with the same id wins. */
export async function loadPlugins(sources: readonly PluginSource[]): Promise<LoadResult> {
  const result: LoadResult = { plugins: [], rejected: [] };
  for (const source of sources) {
    for (const found of await source.list()) {
      const parsed = parseManifest(found.manifest);
      if (!parsed.ok) {
        result.rejected.push({ origin: found.origin, errors: parsed.errors });
      } else if (result.plugins.some((plugin) => plugin.manifest.id === parsed.manifest.id)) {
        result.rejected.push({ origin: found.origin, errors: [`id "${parsed.manifest.id}" is already loaded`] });
      } else if (found.main.trim() === '') {
        result.rejected.push({ origin: found.origin, errors: ['main.js is empty'] });
      } else {
        result.plugins.push({
          manifest: parsed.manifest,
          main: found.main,
          origin: found.origin,
          builtin: found.builtin,
        });
      }
    }
  }
  return result;
}

/** The app's id for a plugin's command: `<plugin id>.<command id>`. */
export const commandId = (plugin: PluginManifest, command: string) => `${plugin.id}.${command}`;

/**
 * Registers [plugin]'s commands in [registry], titled "<plugin>: <title>",
 * each running [run] with the plugin's own command id. Returns the disposer
 * that unregisters them all.
 */
export function registerContributions(
  plugin: PluginManifest,
  registry: CommandRegistry,
  run: (command: string) => Promise<void>,
): () => void {
  const disposers = plugin.contributes.commands.map((command) => {
    const registered: Command = {
      id: commandId(plugin, command.id),
      title: `${plugin.name}: ${command.title}`,
      run: () => run(command.id),
    };
    return registry.register(registered);
  });
  return () => disposers.forEach((dispose) => dispose());
}

/** The plugins that come with Pepino, bundled from src/plugins/<name>/{plugin.json,main.js}. */
export function builtinSource(): PluginSource {
  const manifests = import.meta.glob<string>('../../plugins/*/plugin.json', {
    query: '?raw',
    import: 'default',
    eager: true,
  });
  const mains = import.meta.glob<string>('../../plugins/*/main.js', { query: '?raw', import: 'default', eager: true });
  return {
    async list() {
      return Object.entries(manifests).map(([path, manifest]) => {
        const folder = path.slice(0, -'plugin.json'.length);
        return {
          origin: `builtin:${folder.split('/').at(-2)}`,
          manifest,
          main: mains[`${folder}main.js`] ?? '',
          builtin: true,
        };
      });
    },
  };
}
