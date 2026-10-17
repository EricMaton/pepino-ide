/*
 * The terminal's row of keys (#40, ADR-004): what a phone's keyboard lacks
 * (Ctrl, Esc, Tab, arrows, | ~ / -). Ctrl is sticky: tapped, it turns the
 * next key into its control code before it goes to the shell, so Ctrl then
 * C is SIGINT. What each key sends is worked out here, pure, so it is tested.
 */

/** A key of the row: [ctrl] is the modifier; the others send something. */
export interface TerminalKey {
  id: string;
  /** What the key shows. */
  label: string;
  /** Its accessible name. */
  title: string;
}

/** The arrow and paging keys: what xterm calls them, and their final byte. */
type Navigation = 'up' | 'down' | 'right' | 'left' | 'home' | 'end' | 'pageUp' | 'pageDown';

export const TERMINAL_KEYS: readonly TerminalKey[] = [
  { id: 'ctrl', label: 'CTRL', title: 'Control: the next key as Ctrl+key' },
  { id: 'esc', label: 'ESC', title: 'Escape' },
  { id: 'tab', label: 'TAB', title: 'Tab' },
  { id: 'left', label: '←', title: 'Left' },
  { id: 'down', label: '↓', title: 'Down' },
  { id: 'up', label: '↑', title: 'Up' },
  { id: 'right', label: '→', title: 'Right' },
  { id: '|', label: '|', title: 'Pipe' },
  { id: '~', label: '~', title: 'Tilde' },
  { id: '/', label: '/', title: 'Slash' },
  { id: '-', label: '-', title: 'Dash' },
  { id: 'home', label: 'HOME', title: 'Home' },
  { id: 'end', label: 'END', title: 'End' },
  { id: 'pageUp', label: 'PGUP', title: 'Page up' },
  { id: 'pageDown', label: 'PGDN', title: 'Page down' },
];

const CSI = '\x1b[';

const NAVIGATION: Record<Navigation, { final: string; tilde?: string }> = {
  up: { final: 'A' },
  down: { final: 'B' },
  right: { final: 'C' },
  left: { final: 'D' },
  home: { final: 'H' },
  end: { final: 'F' },
  pageUp: { final: '~', tilde: '5' },
  pageDown: { final: '~', tilde: '6' },
};

const isNavigation = (id: string): id is Navigation => id in NAVIGATION;

/**
 * [char] as Ctrl+[char] sends it: Ctrl+C is \x03, Ctrl+[ is Escape, Ctrl+?
 * is DEL. Null for one with no control code (a digit, an accented letter).
 */
export function controlCode(char: string): string | null {
  if (char.length !== 1) return null;
  const code = char.charCodeAt(0);
  if (code >= 0x61 && code <= 0x7a) return String.fromCharCode(code - 0x60); // a-z
  if (code >= 0x40 && code <= 0x5f) return String.fromCharCode(code - 0x40); // @ A-Z [ \ ] ^ _
  if (char === ' ') return '\x00';
  if (char === '?') return '\x7f';
  return null;
}

/**
 * What typing [data] sends with Ctrl held: its first character as its
 * control code (the rest as it is: a keyboard can send a word at once).
 */
export function withControl(data: string): string {
  const first = [...data][0] ?? '';
  const control = controlCode(first);
  return control === null ? data : control + data.slice(first.length);
}

/**
 * What key [id] sends: [ctrl] when Ctrl is held (Ctrl+arrow as xterm sends
 * it), and arrows in the program's "application cursor" mode when it asked
 * for it (vim, less: \x1bOA rather than \x1b[A). Null for Ctrl itself.
 */
export function keySequence(id: string, { ctrl = false, applicationCursor = false } = {}): string | null {
  if (id === 'ctrl') return null;
  if (id === 'esc') return '\x1b';
  if (id === 'tab') return '\t';
  if (isNavigation(id)) {
    const { final, tilde } = NAVIGATION[id];
    if (tilde) return ctrl ? `${CSI}${tilde};5~` : `${CSI}${tilde}~`;
    if (ctrl) return `${CSI}1;5${final}`;
    return applicationCursor ? `\x1bO${final}` : `${CSI}${final}`;
  }
  return ctrl ? withControl(id) : id;
}
