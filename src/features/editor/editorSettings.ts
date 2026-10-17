import type { KeyValueStore } from '../../core/storage';
import { clampFontSize, DEFAULT_FONT_SIZE, FONT_SIZE_KEY } from './zoom';

/*
 * The editor's settings (#45), shared by every file and the diffs: the font
 * size (also set by pinching, #16), the tab size, whether Tab indents with
 * spaces or a tab, word wrap, and the line numbers. Kept in the preferences;
 * open editors follow a change at once (CodeMirror compartments).
 */

export interface EditorSettings {
  fontSize: number;
  tabSize: number;
  /** Indent with spaces (tabSize of them) rather than a tab character. */
  insertSpaces: boolean;
  wordWrap: boolean;
  lineNumbers: boolean;
}

export const TAB_SIZES = [2, 4, 8] as const;

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  fontSize: DEFAULT_FONT_SIZE,
  tabSize: 2,
  insertSpaces: true,
  wordWrap: true,
  lineNumbers: true,
};

/** Where all but the font size are kept (the font size keeps its own key, from before #45). */
export const EDITOR_SETTINGS_KEY = 'pepino.editor.settings';

/** The saved settings read back: anything missing or broken is the default. */
export function parseEditorSettings(raw: string | null, fontSize: string | null): EditorSettings {
  let saved: Partial<Record<keyof EditorSettings, unknown>> = {};
  try {
    if (raw) saved = JSON.parse(raw) as typeof saved;
  } catch {
    // Broken: the defaults
  }
  const flag = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
  return {
    fontSize: fontSize === null ? DEFAULT_FONT_SIZE : clampFontSize(Number(fontSize)),
    tabSize: TAB_SIZES.includes(saved.tabSize as 2) ? (saved.tabSize as number) : DEFAULT_EDITOR_SETTINGS.tabSize,
    insertSpaces: flag(saved.insertSpaces, DEFAULT_EDITOR_SETTINGS.insertSpaces),
    wordWrap: flag(saved.wordWrap, DEFAULT_EDITOR_SETTINGS.wordWrap),
    lineNumbers: flag(saved.lineNumbers, DEFAULT_EDITOR_SETTINGS.lineNumbers),
  };
}

/** One indent: [tabSize] spaces, or a tab. */
export const indentOf = (settings: Pick<EditorSettings, 'tabSize' | 'insertSpaces'>) =>
  settings.insertSpaces ? ' '.repeat(settings.tabSize) : '\t';

export interface EditorSettingsStore {
  get(): EditorSettings;
  /**
   * Changes some settings; [persist] false only shows them (a pinch in
   * progress), and the last change before one that persists is kept.
   */
  set(change: Partial<EditorSettings>, persist?: boolean): Promise<void>;
  subscribe(listener: (settings: EditorSettings) => void): () => void;
}

export function createEditorSettingsStore(preferences: KeyValueStore): EditorSettingsStore {
  let settings = DEFAULT_EDITOR_SETTINGS;
  let changed = false;
  const listeners = new Set<(settings: EditorSettings) => void>();
  const notify = () => listeners.forEach((listener) => listener(settings));

  Promise.all([preferences.get(EDITOR_SETTINGS_KEY), preferences.get(FONT_SIZE_KEY)]).then(
    ([raw, fontSize]) => {
      // A change made while they loaded wins
      if (changed) return;
      settings = parseEditorSettings(raw, fontSize);
      notify();
    },
    () => undefined,
  );

  return {
    get: () => settings,
    async set(change, persist = true) {
      changed = true;
      const next = { ...settings, ...change, fontSize: clampFontSize(change.fontSize ?? settings.fontSize) };
      settings = next;
      notify();
      if (!persist) return;
      const { fontSize, ...rest } = next;
      await Promise.all([
        preferences.set(FONT_SIZE_KEY, String(fontSize)),
        preferences.set(EDITOR_SETTINGS_KEY, JSON.stringify(rest)),
      ]);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
