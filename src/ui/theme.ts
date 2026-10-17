/*
 * Themes (#44): dark (Pepino's own), light, the phone's (system), or custom:
 * a base, dark or light, with an accent of one's own. A theme only redefines
 * the semantic layer of tokens.css: data-theme="light" swaps the light one in
 * (tokens.css), and a custom accent overrides --primary. The editor, the
 * terminal and the diffs read those tokens, so they follow.
 */

export type ThemeBase = 'dark' | 'light';

export type ThemeChoice =
  | { mode: 'dark' | 'light' | 'system' }
  | {
      mode: 'custom';
      base: ThemeBase;
      /** The accent (--primary), as #rrggbb. */
      accent: string;
    };

/** What a choice comes to on this phone, now: the base, and an accent when it is not the base's own. */
export interface ResolvedTheme {
  base: ThemeBase;
  accent: string | null;
}

export const DEFAULT_THEME: ThemeChoice = { mode: 'dark' };

/** Accents to pick from in a custom theme; any #rrggbb works too. */
export const ACCENTS: readonly { name: string; color: string }[] = [
  { name: 'Pepino red', color: '#e10600' },
  { name: 'Pickle green', color: '#2fbf5a' },
  { name: 'Amber', color: '#f2a516' },
  { name: 'Blue', color: '#2f7cf6' },
  { name: 'Violet', color: '#8b5cf6' },
  { name: 'Cyan', color: '#0eb5c4' },
  { name: 'Pink', color: '#e8458b' },
];

/** The preference's key. */
export const THEME_KEY = 'pepino.theme';

export const isHexColor = (text: string) => /^#[0-9a-fA-F]{6}$/.test(text.trim());

/** A saved choice, read back; anything missing or broken is the default. */
export function parseThemeChoice(raw: string | null | undefined): ThemeChoice {
  if (!raw) return DEFAULT_THEME;
  try {
    const value = JSON.parse(raw) as Partial<{ mode: string; base: string; accent: string }>;
    if (value.mode === 'dark' || value.mode === 'light' || value.mode === 'system') return { mode: value.mode };
    if (
      value.mode === 'custom' &&
      (value.base === 'dark' || value.base === 'light') &&
      isHexColor(value.accent ?? '')
    ) {
      return { mode: 'custom', base: value.base, accent: value.accent!.toLowerCase() };
    }
  } catch {
    // A broken preference is the default
  }
  return DEFAULT_THEME;
}

/** [choice] on a phone whose own appearance is dark ([systemDark]) or not. */
export function resolveTheme(choice: ThemeChoice, systemDark: boolean): ResolvedTheme {
  switch (choice.mode) {
    case 'dark':
      return { base: 'dark', accent: null };
    case 'light':
      return { base: 'light', accent: null };
    case 'system':
      return { base: systemDark ? 'dark' : 'light', accent: null };
    case 'custom':
      return { base: choice.base, accent: choice.accent };
  }
}

/** The page's background for a base, as the browser chrome and system bars want it (tokens.css's --bg). */
export const BACKGROUNDS: Record<ThemeBase, string> = { dark: '#0a0a0a', light: '#f4f2ec' };

/** Text drawn on an accent: white on a dark accent, black on a light one (by its relative luminance). */
export function onAccent(accent: string): string {
  const channel = (offset: number) => {
    const value = parseInt(accent.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.45 ? '#0a0a0a' : '#f2f2f2';
}

/** Puts [theme] on the page: data-theme for the base, the accent's tokens, the browser's theme colour. */
export function applyTheme(theme: ResolvedTheme, root: HTMLElement = document.documentElement) {
  root.dataset.theme = theme.base;
  if (theme.accent) {
    root.style.setProperty('--primary', theme.accent);
    root.style.setProperty('--on-primary', onAccent(theme.accent));
  } else {
    root.style.removeProperty('--primary');
    root.style.removeProperty('--on-primary');
  }
  root.ownerDocument.querySelector('meta[name="theme-color"]')?.setAttribute('content', BACKGROUNDS[theme.base]);
  // What reads colours itself (xterm) hears it
  root.ownerDocument.defaultView?.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: theme }));
}

/** Dispatched on window when a theme is applied. */
export const THEME_EVENT = 'pepino:theme';
