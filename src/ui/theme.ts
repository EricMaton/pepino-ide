/*
 * Themes (#44): dark (Pepino's own), light, the phone's (system), custom (a
 * base, dark or light, with an accent of one's own), or one a plugin brings
 * (#52). A theme only redefines the semantic layer of tokens.css:
 * data-theme="light" swaps the light one in (tokens.css), and a custom
 * accent or a plugin's colours override tokens inline. The editor, the
 * terminal and the diffs read those tokens, so they follow.
 */

export type ThemeBase = 'dark' | 'light';

/** The tokens a plugin's theme may set (#52), by the name plugin.json gives them. */
export const THEME_TOKENS = {
  bg: '--bg',
  fg: '--fg',
  surface: '--surface',
  surfaceVariant: '--surface-variant',
  primary: '--primary',
  onPrimary: '--on-primary',
  error: '--error',
  outline: '--outline',
  gitAdded: '--git-added',
  gitModified: '--git-modified',
  gitRemoved: '--git-removed',
  onGit: '--on-git',
} as const;

export type ThemeToken = keyof typeof THEME_TOKENS;

/** Colours over a base's own, each #rrggbb; a token left out keeps the base's. */
export type ThemeColors = Partial<Record<ThemeToken, string>>;

/** A theme a running plugin brings (#52): `<plugin id>.<theme id>`. */
export interface ContributedTheme {
  id: string;
  label: string;
  /** The plugin's name. */
  plugin: string;
  base: ThemeBase;
  colors: ThemeColors;
}

export type ThemeChoice =
  | { mode: 'dark' | 'light' | 'system' }
  | {
      mode: 'custom';
      base: ThemeBase;
      /** The accent (--primary), as #rrggbb. */
      accent: string;
    }
  | {
      mode: 'plugin';
      /** The contributed theme's id. */
      id: string;
      /** A copy of its base and colours: it shows from the first paint, before the plugins load. */
      base: ThemeBase;
      colors: ThemeColors;
    };

/** What a choice comes to on this phone, now: the base, and an accent or colours when not the base's own. */
export interface ResolvedTheme {
  base: ThemeBase;
  accent: string | null;
  colors?: ThemeColors;
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

/** [raw] as theme colours: known tokens, #rrggbb values (lower case); what is wrong, listed. */
export function parseThemeColors(raw: unknown): { colors: ThemeColors; errors: string[] } {
  const colors: ThemeColors = {};
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { colors, errors: ['an object'] };
  for (const [token, value] of Object.entries(raw)) {
    if (!(token in THEME_TOKENS)) errors.push(`"${token}" is not one of ${Object.keys(THEME_TOKENS).join(', ')}`);
    else if (typeof value !== 'string' || !isHexColor(value)) errors.push(`${token}: #rrggbb`);
    else colors[token as ThemeToken] = value.trim().toLowerCase();
  }
  return { colors, errors };
}

/** A saved choice, read back; anything missing or broken is the default. */
export function parseThemeChoice(raw: string | null | undefined): ThemeChoice {
  if (!raw) return DEFAULT_THEME;
  try {
    const value = JSON.parse(raw) as Partial<{
      mode: string;
      base: string;
      accent: string;
      id: string;
      colors: unknown;
    }>;
    if (value.mode === 'dark' || value.mode === 'light' || value.mode === 'system') return { mode: value.mode };
    if (
      value.mode === 'custom' &&
      (value.base === 'dark' || value.base === 'light') &&
      isHexColor(value.accent ?? '')
    ) {
      return { mode: 'custom', base: value.base, accent: value.accent!.toLowerCase() };
    }
    if (
      value.mode === 'plugin' &&
      typeof value.id === 'string' &&
      value.id !== '' &&
      (value.base === 'dark' || value.base === 'light')
    ) {
      return { mode: 'plugin', id: value.id, base: value.base, colors: parseThemeColors(value.colors).colors };
    }
  } catch {
    // A broken preference is the default
  }
  return DEFAULT_THEME;
}

/**
 * [choice] on a phone whose own appearance is dark ([systemDark]) or not.
 * A plugin's theme is looked up in [contributed], the themes of the running
 * plugins: until they have loaded (null) its saved copy shows; once they have,
 * a theme whose plugin is gone falls back to its bare base.
 */
export function resolveTheme(
  choice: ThemeChoice,
  systemDark: boolean,
  contributed: readonly ContributedTheme[] | null = null,
): ResolvedTheme {
  switch (choice.mode) {
    case 'dark':
      return { base: 'dark', accent: null };
    case 'light':
      return { base: 'light', accent: null };
    case 'system':
      return { base: systemDark ? 'dark' : 'light', accent: null };
    case 'custom':
      return { base: choice.base, accent: choice.accent };
    case 'plugin': {
      if (contributed === null) return { base: choice.base, accent: null, colors: choice.colors };
      const theme = contributed.find((candidate) => candidate.id === choice.id);
      return theme ? { base: theme.base, accent: null, colors: theme.colors } : { base: choice.base, accent: null };
    }
  }
}

/** A base's own background, text and accent (tokens.css), for previews of a theme. */
export const BASE_COLORS: Record<ThemeBase, { bg: string; fg: string; primary: string }> = {
  dark: { bg: '#0a0a0a', fg: '#f2f2f2', primary: '#e10600' },
  light: { bg: '#f4f2ec', fg: '#0a0a0a', primary: '#d10500' },
};

/** The page's background for a base, as the browser chrome and system bars want it (tokens.css's --bg). */
export const BACKGROUNDS: Record<ThemeBase, string> = { dark: BASE_COLORS.dark.bg, light: BASE_COLORS.light.bg };

/** Text drawn on an accent: white on a dark accent, black on a light one (by its relative luminance). */
export function onAccent(accent: string): string {
  const channel = (offset: number) => {
    const value = parseInt(accent.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.45 ? '#0a0a0a' : '#f2f2f2';
}

/** Puts [theme] on the page: data-theme for the base, its accent or colours inline, the browser's theme colour. */
export function applyTheme(theme: ResolvedTheme, root: HTMLElement = document.documentElement) {
  root.dataset.theme = theme.base;
  const colors: ThemeColors = { ...theme.colors };
  if (theme.accent) colors.primary = theme.accent;
  // Text on an accent of one's own reads on it, unless the theme says what it is
  if (colors.primary && !colors.onPrimary) colors.onPrimary = onAccent(colors.primary);
  for (const [token, property] of Object.entries(THEME_TOKENS)) {
    const value = colors[token as ThemeToken];
    if (value) root.style.setProperty(property, value);
    else root.style.removeProperty(property);
  }
  root.ownerDocument
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', colors.bg ?? BACKGROUNDS[theme.base]);
  // What reads colours itself (xterm) hears it
  root.ownerDocument.defaultView?.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: theme }));
}

/** Dispatched on window when a theme is applied. */
export const THEME_EVENT = 'pepino:theme';
