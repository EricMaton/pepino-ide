import { describe, expect, it, vi } from 'vitest';
import { CommandRegistry } from '../../core/commands';
import { builtinSource, loadPlugins, type PluginSource, registerContributions } from './loader';

const manifest = (id: string, extra: object = {}) =>
  JSON.stringify({
    id,
    name: 'Tool',
    version: '1.0.0',
    apiVersion: '1',
    contributes: { commands: [{ id: 'go', title: 'Go' }] },
    ...extra,
  });

const source = (...packages: { origin: string; manifest: string; main?: string }[]): PluginSource => ({
  list: async () => packages.map((found) => ({ main: 'plugin.onActivate(() => {})', builtin: false, ...found })),
});

describe('plugin loader (#46)', () => {
  it('loads the packages whose manifest holds, and says why the others are not', async () => {
    const result = await loadPlugins([
      source(
        { origin: 'a', manifest: manifest('dev.pepino.a') },
        { origin: 'old', manifest: manifest('dev.pepino.old', { apiVersion: '0' }) },
        { origin: 'twin', manifest: manifest('dev.pepino.a') },
        { origin: 'empty', manifest: manifest('dev.pepino.empty'), main: ' ' },
      ),
    ]);

    expect(result.plugins.map((plugin) => plugin.manifest.id)).toEqual(['dev.pepino.a']);
    expect(result.rejected).toEqual([
      { origin: 'old', errors: ['apiVersion "0" is not one this Pepino runs (1)'] },
      { origin: 'twin', errors: ['id "dev.pepino.a" is already loaded'] },
      { origin: 'empty', errors: ['main.js is empty, and the plugin has commands'] },
    ]);
  });

  it('registers a plugin’s commands, and its disposer takes them all away', async () => {
    const { plugins } = await loadPlugins([source({ origin: 'a', manifest: manifest('dev.pepino.a') })]);
    const registry = new CommandRegistry();
    const run = vi.fn(async () => undefined);

    const dispose = registerContributions(plugins[0].manifest, registry, run);
    const command = registry.find('dev.pepino.a.go');
    expect(command?.title).toBe('Tool: Go');
    await command?.run();
    expect(run).toHaveBeenCalledWith('go');

    dispose();
    expect(registry.all).toEqual([]);
  });

  it('the plugins that come with Pepino load', async () => {
    const { plugins, rejected } = await loadPlugins([builtinSource()]);
    expect(rejected).toEqual([]);
    expect(plugins.find((plugin) => plugin.manifest.id === 'dev.pepino.hello-world')).toMatchObject({
      origin: 'builtin:hello-world',
      builtin: true,
      main: expect.stringContaining("api.commands.register('hello'"),
    });
  });
});
