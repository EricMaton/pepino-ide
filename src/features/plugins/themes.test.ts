import { describe, expect, it, vi } from 'vitest';
import { CommandDispatcher, CommandRegistry } from '../../core/commands';
import { EventBus } from '../../core/events';
import { createActiveEditor } from '../editor/activeEditor';
import { PluginHost } from './host';
import { loadPlugins, type PluginSource } from './loader';
import { parseManifest } from './manifest';
import { PluginManager } from './manager';
import { createPluginPermissions } from './permissions';

/*
 * Themes from plugins (#52): declared in plugin.json, colours only, no code
 * needed; the app offers them while their plugin runs.
 */
const pluginEvents = () =>
  new EventBus<{
    'file.saved': { path: string };
    'file.opened': { path: string };
    'editor.changed': { path: string };
  }>();

const NIGHT = {
  id: 'night',
  label: 'Night',
  base: 'dark',
  colors: { bg: '#101820', primary: '#F2A516' },
};

const themed = (themes: unknown[], extra: object = {}) =>
  JSON.stringify({
    id: 'dev.test.themes',
    name: 'Themes',
    version: '1.0.0',
    apiVersion: '1',
    ...extra,
    contributes: { themes },
  });

describe('themes from plugins (#52)', () => {
  it('a manifest declares themes: a base and colours of the semantic tokens', () => {
    const result = parseManifest(themed([NIGHT]));
    expect(result).toMatchObject({
      ok: true,
      manifest: {
        contributes: {
          themes: [{ id: 'night', label: 'Night', base: 'dark', colors: { bg: '#101820', primary: '#f2a516' } }],
        },
      },
    });
  });

  it('refuses anything but known tokens and #rrggbb colours: a theme can carry no CSS of its own', () => {
    const result = parseManifest(
      themed([
        { ...NIGHT, id: 'loud', colors: { bg: 'red', background: '#000000', primary: '#fff; }' } },
        { ...NIGHT, id: 'dim', base: 'grey' },
        NIGHT,
        NIGHT,
      ]),
    );
    expect(result).toEqual({
      ok: false,
      errors: [
        'contributes.themes[0].colors: bg: #rrggbb',
        expect.stringMatching(/^contributes\.themes\[0\]\.colors: "background" is not one of bg, fg, /),
        'contributes.themes[0].colors: primary: #rrggbb',
        'contributes.themes[1]: { id, label, base: dark|light, colors }',
        'contributes.themes[3]: "night" twice',
      ],
    });
  });

  it('a plugin that only brings themes needs no main.js, and runs without a worker', async () => {
    const source: PluginSource = {
      list: async () => [{ origin: 'test', manifest: themed([NIGHT]), main: '', builtin: false }],
    };
    const { plugins, rejected } = await loadPlugins([source]);
    expect(rejected).toEqual([]);

    const connect = vi.fn();
    const registry = new CommandRegistry();
    const host = new PluginHost({
      registry,
      dispatcher: new CommandDispatcher(registry),
      events: pluginEvents(),
      activeEditor: createActiveEditor(),
      connect,
    });
    await host.start(plugins[0]);
    expect(host.list()[0].state).toBe('running');
    expect(connect).not.toHaveBeenCalled();
  });

  it('the app is offered the themes of the running plugins, once they have loaded', async () => {
    const saved = new Map<string, string>();
    const preferences = {
      get: async (key: string) => saved.get(key) ?? null,
      set: async (key: string, value: string) => void saved.set(key, value),
    };
    const registry = new CommandRegistry();
    const host = new PluginHost({
      registry,
      dispatcher: new CommandDispatcher(registry),
      events: pluginEvents(),
      activeEditor: createActiveEditor(),
      connect: vi.fn(),
    });
    const source: PluginSource = {
      list: async () => [{ origin: 'test', manifest: themed([NIGHT]), main: '', builtin: false }],
    };
    const manager = new PluginManager(host, createPluginPermissions(preferences), () => [source]);

    expect(manager.themes()).toBeNull();
    await manager.load();
    expect(manager.themes()).toEqual([
      {
        id: 'dev.test.themes.night',
        label: 'Night',
        plugin: 'Themes',
        base: 'dark',
        colors: { bg: '#101820', primary: '#f2a516' },
      },
    ]);

    // Turned off, its themes go with it; on again, they are back
    await manager.setEnabled('dev.test.themes', false);
    expect(manager.themes()).toEqual([]);
    await manager.setEnabled('dev.test.themes', true);
    expect(manager.themes()?.map((theme) => theme.id)).toEqual(['dev.test.themes.night']);
  });
});
