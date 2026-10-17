import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import type { KeyValueStore } from '../core/storage';
import {
  applyTheme,
  type ContributedTheme,
  parseThemeChoice,
  type ResolvedTheme,
  resolveTheme,
  THEME_KEY,
  type ThemeChoice,
} from './theme';

/**
 * The theme chosen (#44): kept in the preferences, applied to the page as
 * soon as the app starts, again when it changes, and when the phone's own
 * appearance does (System). A copy in localStorage is read before the first
 * paint, so a light theme does not flash dark while the preferences load.
 * The themes plugins bring (#52) arrive once the plugins have loaded.
 */
export interface ThemeStore {
  choice(): ThemeChoice;
  /** What it comes to now (System follows the phone). */
  resolved(): ResolvedTheme;
  set(choice: ThemeChoice): Promise<void>;
  /** The themes of the running plugins; null until they have loaded. */
  contributed(): readonly ContributedTheme[] | null;
  /** The plugins have loaded, or started or stopped one: these are the themes they bring now. */
  setContributed(themes: readonly ContributedTheme[]): void;
  /** Called with the choice whenever it, what it resolves to, or the plugins' themes change. */
  subscribe(listener: (choice: ThemeChoice) => void): () => void;
}

const mirror = {
  read: (): string | null => {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch {
      return null;
    }
  },
  write: (value: string) => {
    try {
      localStorage.setItem(THEME_KEY, value);
    } catch {
      // Only a quicker start is lost
    }
  },
};

export function createThemeStore(preferences: KeyValueStore): ThemeStore {
  const dark = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  let choice = parseThemeChoice(mirror.read());
  let contributed: readonly ContributedTheme[] | null = null;
  const listeners = new Set<(choice: ThemeChoice) => void>();

  const resolved = () => resolveTheme(choice, dark?.matches ?? true, contributed);
  const apply = () => {
    const theme = resolved();
    applyTheme(theme);
    // The status bar's icons: light on a dark base, dark on a light one
    if (Capacitor.isNativePlatform()) {
      SystemBars.setStyle({ style: theme.base === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(
        () => undefined,
      );
    }
    listeners.forEach((listener) => listener(choice));
  };

  apply();
  dark?.addEventListener('change', () => {
    if (choice.mode === 'system') apply();
  });
  // The preference is what counts: the mirror is only a head start
  preferences.get(THEME_KEY).then(
    (raw) => {
      const saved = parseThemeChoice(raw);
      if (JSON.stringify(saved) === JSON.stringify(choice)) return;
      choice = saved;
      mirror.write(JSON.stringify(saved));
      apply();
    },
    () => undefined,
  );

  return {
    choice: () => choice,
    resolved,
    async set(next) {
      choice = next;
      const raw = JSON.stringify(next);
      mirror.write(raw);
      apply();
      await preferences.set(THEME_KEY, raw);
    },
    contributed: () => contributed,
    setContributed(themes) {
      contributed = themes;
      // A plugin's theme chosen and still there: its saved copy follows it, for the next start
      const chosen = choice;
      const theme = chosen.mode === 'plugin' ? themes.find((candidate) => candidate.id === chosen.id) : undefined;
      if (
        chosen.mode === 'plugin' &&
        theme &&
        (theme.base !== chosen.base || JSON.stringify(theme.colors) !== JSON.stringify(chosen.colors))
      ) {
        choice = { mode: 'plugin', id: theme.id, base: theme.base, colors: theme.colors };
        const raw = JSON.stringify(choice);
        mirror.write(raw);
        preferences.set(THEME_KEY, raw).catch(() => undefined);
      }
      apply();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
