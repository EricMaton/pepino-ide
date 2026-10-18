import type { KeyValueStore } from '../../core/storage';
import type { Permission, PluginManifest } from './manifest';

/*
 * What the user let each plugin do (#49, spec v1): permissions are declared
 * in the manifest, approved by the user before the plugin first runs, and
 * checked by the host on every call. A new version asking for more is asked
 * about again, for the new ones only. Whether a plugin is on is kept here too.
 */

/** Each permission, as the approval dialog explains it. */
export const PERMISSION_INFO: Record<Permission, { title: string; detail: string }> = {
  'editor.read': { title: 'Read the editor', detail: 'The file open in the editor: its name, text and selection.' },
  'editor.write': {
    title: 'Change the editor',
    detail: 'Insert or replace text in the file open in the editor (you can undo it).',
  },
  'git.read': { title: 'Read git', detail: "Your repositories' status, history and diffs." },
  'git.write': { title: 'Write git', detail: 'Commit and push, each time with your confirmation.' },
  network: { title: 'Use the internet', detail: 'Send and receive data over the network.' },
  'fs.read': { title: 'Read files', detail: "Your projects' files." },
  'fs.write': { title: 'Write files', detail: "Create, change and delete your projects' files." },
};

export const PLUGINS_STATE_KEY = 'pepino.plugins';

interface SavedPlugin {
  enabled: boolean;
  approved: Permission[];
}

export interface PluginPermissions {
  /** Read the saved state; until then, nothing is approved and plugins are off. */
  load(): Promise<void>;
  /** Whether [plugin] may use [permission] now: declared and approved. */
  allowed(plugin: PluginManifest, permission: Permission): boolean;
  /** The permissions [plugin] asks for that the user has not approved (yet). */
  missing(plugin: PluginManifest): Permission[];
  /** On unless turned off: plugins start on, once approved. */
  enabled(id: string): boolean;
  /** Approves every permission [plugin] asks for, and turns it on. */
  approve(plugin: PluginManifest): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  /** Plugin [id] was uninstalled (#56): what it was allowed goes with it. */
  forget(id: string): Promise<void>;
}

export function createPluginPermissions(preferences: KeyValueStore): PluginPermissions {
  let saved: Record<string, SavedPlugin> = {};
  const save = () => preferences.set(PLUGINS_STATE_KEY, JSON.stringify(saved));
  const entry = (id: string): SavedPlugin => saved[id] ?? { enabled: true, approved: [] };

  return {
    async load() {
      try {
        const raw = await preferences.get(PLUGINS_STATE_KEY);
        const parsed = raw ? (JSON.parse(raw) as unknown) : {};
        saved = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, SavedPlugin>) : {};
      } catch {
        saved = {};
      }
    },
    allowed: (plugin, permission) =>
      plugin.permissions.includes(permission) && entry(plugin.id).approved.includes(permission),
    missing: (plugin) => plugin.permissions.filter((permission) => !entry(plugin.id).approved.includes(permission)),
    enabled: (id) => entry(id).enabled !== false,
    async approve(plugin) {
      const approved = [...new Set([...entry(plugin.id).approved, ...plugin.permissions])];
      saved = { ...saved, [plugin.id]: { enabled: true, approved } };
      await save();
    },
    async setEnabled(id, enabled) {
      saved = { ...saved, [id]: { ...entry(id), enabled } };
      await save();
    },
    async forget(id) {
      const { [id]: _forgotten, ...rest } = saved;
      saved = rest;
      await save();
    },
  };
}
