import { parseThemeColors, type ThemeBase, type ThemeColors } from '../../ui/theme';

/*
 * A plugin's manifest, plugin.json (#46, docs/plugin-api/v1-spec.md): who it
 * is, which API version it speaks, the permissions it asks for, and what it
 * contributes (commands, toolbar keys, settings, themes). Read from untrusted
 * JSON: everything is checked, and a plugin whose manifest fails is not loaded.
 */

/** The API versions this Pepino runs. A plugin for another one is refused, never half-run. */
export const SUPPORTED_API_VERSIONS: readonly string[] = ['1'];

export const PERMISSIONS = [
  'editor.read',
  'editor.write',
  'git.read',
  'git.write',
  'network',
  'fs.read',
  'fs.write',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export interface CommandContribution {
  /** Unique within the plugin; the app's id is `<plugin id>.<id>`. */
  id: string;
  title: string;
}

export interface ToolbarContribution {
  command: string;
  icon?: string;
  label?: string;
}

export type SettingValue = number | string | boolean;

export interface SettingContribution {
  key: string;
  type: 'number' | 'string' | 'boolean';
  default: SettingValue;
  title?: string;
}

/** A theme (#52): colours over a base, only the semantic tokens, each #rrggbb (no CSS of its own). */
export interface ThemeContribution {
  /** Unique within the plugin; the app's id is `<plugin id>.<id>`. */
  id: string;
  label: string;
  base: ThemeBase;
  colors: ThemeColors;
}

export interface PluginManifest {
  /** Reverse-domain: "com.example.beautifier". */
  id: string;
  name: string;
  version: string;
  apiVersion: string;
  description?: string;
  permissions: Permission[];
  /** Why the plugin needs the network: required with the `network` permission (spec v1). */
  networkJustification?: string;
  contributes: {
    commands: CommandContribution[];
    toolbar: ToolbarContribution[];
    settings: SettingContribution[];
    themes: ThemeContribution[];
  };
}

export type ManifestResult = { ok: true; manifest: PluginManifest } | { ok: false; errors: string[] };

const ID = /^[a-z0-9]+(?:[-_][a-z0-9]+)*(?:\.[a-z0-9]+(?:[-_][a-z0-9]+)*)+$/;
const LOCAL_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/** [text], plugin.json's contents, checked. Every problem is listed, not just the first. */
export function parseManifest(text: string): ManifestResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`plugin.json is not JSON: ${(error as Error).message}`] };
  }
  if (!isObject(raw)) return { ok: false, errors: ['plugin.json must be an object'] };
  const errors: string[] = [];

  if (!isText(raw.id) || !ID.test(raw.id)) errors.push('id: a reverse-domain name such as "com.example.tool"');
  if (!isText(raw.name)) errors.push('name: required');
  if (!isText(raw.version) || !VERSION.test(raw.version)) errors.push('version: x.y.z');
  if (!isText(raw.apiVersion)) errors.push('apiVersion: required');
  else if (!SUPPORTED_API_VERSIONS.includes(raw.apiVersion)) {
    errors.push(`apiVersion "${raw.apiVersion}" is not one this Pepino runs (${SUPPORTED_API_VERSIONS.join(', ')})`);
  }
  if (raw.description !== undefined && typeof raw.description !== 'string') errors.push('description: text');

  const permissions: Permission[] = [];
  if (raw.permissions !== undefined && !Array.isArray(raw.permissions)) errors.push('permissions: a list');
  for (const permission of Array.isArray(raw.permissions) ? raw.permissions : []) {
    if ((PERMISSIONS as readonly unknown[]).includes(permission)) {
      if (!permissions.includes(permission as Permission)) permissions.push(permission as Permission);
    } else errors.push(`permissions: "${String(permission)}" is not one of ${PERMISSIONS.join(', ')}`);
  }
  if (permissions.includes('network') && !isText(raw.networkJustification)) {
    errors.push('networkJustification: say why the plugin needs the network');
  }

  const contributes = raw.contributes === undefined ? {} : raw.contributes;
  if (!isObject(contributes)) errors.push('contributes: an object');
  const list = (name: string): unknown[] => {
    const value = isObject(contributes) ? contributes[name] : undefined;
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      errors.push(`contributes.${name}: a list`);
      return [];
    }
    return value;
  };

  const commands: CommandContribution[] = [];
  for (const [i, command] of list('commands').entries()) {
    if (!isObject(command) || !isText(command.id) || !LOCAL_ID.test(command.id) || !isText(command.title)) {
      errors.push(`contributes.commands[${i}]: { id, title }`);
    } else if (commands.some((other) => other.id === command.id)) {
      errors.push(`contributes.commands[${i}]: "${command.id}" twice`);
    } else commands.push({ id: command.id, title: command.title });
  }

  const toolbar: ToolbarContribution[] = [];
  for (const [i, key] of list('toolbar').entries()) {
    if (!isObject(key) || !isText(key.command) || !commands.some((command) => command.id === key.command)) {
      errors.push(`contributes.toolbar[${i}]: { command } naming one of the plugin's commands`);
    } else {
      toolbar.push({
        command: key.command,
        ...(isText(key.icon) && { icon: key.icon }),
        ...(isText(key.label) && { label: key.label }),
      });
    }
  }

  const settings: SettingContribution[] = [];
  for (const [i, setting] of list('settings').entries()) {
    const typed =
      isObject(setting) &&
      (setting.type === 'number' || setting.type === 'string' || setting.type === 'boolean') &&
      typeof setting.default === setting.type;
    if (!isObject(setting) || !isText(setting.key) || !typed) {
      errors.push(`contributes.settings[${i}]: { key, type: number|string|boolean, default of that type }`);
    } else {
      settings.push({
        key: setting.key as string,
        type: setting.type as SettingContribution['type'],
        default: setting.default as SettingValue,
        ...(isText(setting.title) && { title: setting.title }),
      });
    }
  }

  const themes: ThemeContribution[] = [];
  for (const [i, theme] of list('themes').entries()) {
    if (
      !isObject(theme) ||
      !isText(theme.id) ||
      !LOCAL_ID.test(theme.id) ||
      !isText(theme.label) ||
      (theme.base !== 'dark' && theme.base !== 'light')
    ) {
      errors.push(`contributes.themes[${i}]: { id, label, base: dark|light, colors }`);
      continue;
    }
    if (themes.some((other) => other.id === theme.id)) {
      errors.push(`contributes.themes[${i}]: "${theme.id}" twice`);
      continue;
    }
    const { colors, errors: wrong } = parseThemeColors(theme.colors ?? {});
    for (const error of wrong) errors.push(`contributes.themes[${i}].colors: ${error}`);
    themes.push({ id: theme.id, label: theme.label.trim(), base: theme.base, colors });
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    manifest: {
      id: raw.id as string,
      name: (raw.name as string).trim(),
      version: raw.version as string,
      apiVersion: raw.apiVersion as string,
      ...(typeof raw.description === 'string' && { description: raw.description }),
      permissions,
      ...(isText(raw.networkJustification) && { networkJustification: raw.networkJustification }),
      contributes: { commands, toolbar, settings, themes },
    },
  };
}
