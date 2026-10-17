import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import type { KeyValueStore } from '../core/storage';
import { applyTheme, parseThemeChoice, type ResolvedTheme, resolveTheme, THEME_KEY, type ThemeChoice } from './theme';

/**
 * The theme chosen (#44): kept in the preferences, applied to the page as
 * soon as the app starts, again when it changes, and when the phone's own
 * appearance does (System). A copy in localStorage is read before the first
 * paint, so a light theme does not flash dark while the preferences load.
 */
export interface ThemeStore {
  choice(): ThemeChoice;
  /** What it comes to now (System follows the phone). */
  resolved(): ResolvedTheme;
  set(choice: ThemeChoice): Promise<void>;
  /** Called with the choice whenever it, or what it resolves to, changes. */
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
  const listeners = new Set<(choice: ThemeChoice) => void>();

  const resolved = () => resolveTheme(choice, dark?.matches ?? true);
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
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
