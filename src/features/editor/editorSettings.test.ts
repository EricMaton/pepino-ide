import { describe, expect, it, vi } from 'vitest';
import {
  createEditorSettingsStore,
  DEFAULT_EDITOR_SETTINGS,
  EDITOR_SETTINGS_KEY,
  indentOf,
  parseEditorSettings,
} from './editorSettings';
import { FONT_SIZE_KEY } from './zoom';

const memory = (values: Record<string, string> = {}) => {
  const saved = new Map(Object.entries(values));
  return {
    saved,
    get: vi.fn(async (key: string) => saved.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => void saved.set(key, value)),
  };
};

describe('editor settings (#45)', () => {
  it('reads the saved settings back, anything broken being the default', () => {
    expect(parseEditorSettings(null, null)).toEqual(DEFAULT_EDITOR_SETTINGS);
    expect(
      parseEditorSettings('{"tabSize":4,"insertSpaces":false,"wordWrap":false,"lineNumbers":false}', '18'),
    ).toEqual({
      fontSize: 18,
      tabSize: 4,
      insertSpaces: false,
      wordWrap: false,
      lineNumbers: false,
    });
    expect(parseEditorSettings('{"tabSize":3,"wordWrap":"yes"}', '99')).toEqual({
      ...DEFAULT_EDITOR_SETTINGS,
      fontSize: 28,
    });
    expect(parseEditorSettings('not json', null)).toEqual(DEFAULT_EDITOR_SETTINGS);
  });

  it('indents with spaces or a tab', () => {
    expect(indentOf({ tabSize: 4, insertSpaces: true })).toBe('    ');
    expect(indentOf({ tabSize: 4, insertSpaces: false })).toBe('\t');
  });

  it('loads, tells its listeners, and keeps the font size under its old key', async () => {
    const preferences = memory({ [FONT_SIZE_KEY]: '16', [EDITOR_SETTINGS_KEY]: '{"tabSize":8}' });
    const store = createEditorSettingsStore(preferences);
    const heard = vi.fn();
    store.subscribe(heard);
    await vi.waitFor(() => expect(store.get()).toMatchObject({ fontSize: 16, tabSize: 8 }));

    // A pinch shows sizes without saving them; letting go saves the last
    await store.set({ fontSize: 20 }, false);
    expect(preferences.set).not.toHaveBeenCalled();
    await store.set({ wordWrap: false });
    expect(preferences.saved.get(FONT_SIZE_KEY)).toBe('20');
    expect(JSON.parse(preferences.saved.get(EDITOR_SETTINGS_KEY)!)).toEqual({
      tabSize: 8,
      insertSpaces: true,
      wordWrap: false,
      lineNumbers: true,
    });
    expect(heard).toHaveBeenLastCalledWith(expect.objectContaining({ fontSize: 20, wordWrap: false }));
  });
});
