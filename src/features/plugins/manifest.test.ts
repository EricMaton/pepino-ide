import { describe, expect, it } from 'vitest';
import { parseManifest } from './manifest';

const valid = {
  id: 'dev.pepino.hello',
  name: 'Hello',
  version: '1.0.0',
  apiVersion: '1',
  permissions: ['editor.read', 'editor.write', 'editor.read'],
  contributes: {
    commands: [{ id: 'hello', title: 'Say hello' }],
    toolbar: [{ command: 'hello', icon: 'wave' }],
    settings: [{ key: 'greeting', type: 'string', default: 'Hola' }],
  },
};

const parse = (manifest: unknown) => parseManifest(JSON.stringify(manifest));

describe('plugin manifest (#46)', () => {
  it('reads a valid manifest, without repeated permissions', () => {
    const result = parse(valid);
    expect(result).toEqual({
      ok: true,
      manifest: {
        ...valid,
        permissions: ['editor.read', 'editor.write'],
        contributes: {
          commands: [{ id: 'hello', title: 'Say hello' }],
          toolbar: [{ command: 'hello', icon: 'wave' }],
          settings: [{ key: 'greeting', type: 'string', default: 'Hola' }],
          themes: [],
          pages: [],
        },
      },
    });
  });

  it('a manifest with only the basics contributes nothing', () => {
    const result = parse({ id: 'dev.pepino.min', name: 'Min', version: '0.1.0', apiVersion: '1' });
    expect(result).toMatchObject({
      ok: true,
      manifest: { permissions: [], contributes: { commands: [], toolbar: [], settings: [] } },
    });
  });

  it('refuses an API version this Pepino does not run', () => {
    expect(parse({ ...valid, apiVersion: '2' })).toEqual({
      ok: false,
      errors: ['apiVersion "2" is not one this Pepino runs (1)'],
    });
  });

  it('lists every problem', () => {
    const result = parse({
      id: 'Hello',
      version: '1',
      apiVersion: '1',
      permissions: ['editor.read', 'root', 'network'],
      contributes: {
        commands: [{ id: 'a', title: 'A' }, { id: 'a', title: 'Again' }, { title: 'No id' }],
        toolbar: [{ command: 'missing' }],
        settings: [{ key: 'n', type: 'number', default: 'two' }],
      },
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toEqual([
      'id: a reverse-domain name such as "com.example.tool"',
      'name: required',
      'version: x.y.z',
      'permissions: "root" is not one of editor.read, editor.write, git.read, git.write, network, fs.read, fs.write',
      'networkJustification: say why the plugin needs the network',
      'contributes.commands[1]: "a" twice',
      'contributes.commands[2]: { id, title }',
      "contributes.toolbar[0]: { command } naming one of the plugin's commands",
      'contributes.settings[0]: { key, type: number|string|boolean, default of that type }',
    ]);
  });

  it('is not fooled by what is not a manifest', () => {
    expect(parseManifest('{ not json')).toMatchObject({ ok: false });
    expect(parseManifest('[]')).toEqual({ ok: false, errors: ['plugin.json must be an object'] });
  });
});
