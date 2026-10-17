import type { AppDestination } from './destinations';

/*
 * The bottom bar (#171): the destinations pinned to it, in the user's order,
 * and ⋯ MORE for the rest (native screens, and later the plugins' own). The
 * user pins and unpins by holding a destination. SETTINGS always stays.
 */

/** At most this many in the bar, MORE aside. */
export const MAX_PINNED = 4;

/** Never moved to MORE. */
export const ALWAYS_PINNED: readonly AppDestination[] = ['settings'];

export const DEFAULT_PINNED: readonly AppDestination[] = ['projects', 'git', 'terminal', 'settings'];

export const NAV_PINNED_KEY = 'pepino.nav.pinned';

export interface NavLayout {
  /** In the bar, in order. */
  bar: AppDestination[];
  /** Behind ⋯ MORE, in the app's order; MORE shows only when there are any. */
  more: AppDestination[];
}

/** Where each of [available] (in the app's order) goes, given what is [pinned]. */
export function layoutNav(available: readonly AppDestination[], pinned: readonly AppDestination[]): NavLayout {
  let bar = pinned.filter((id, i) => available.includes(id) && pinned.indexOf(id) === i);
  for (const id of ALWAYS_PINNED) if (available.includes(id) && !bar.includes(id)) bar.push(id);
  // Too many (a saved list from a wider bar): the ones that may go, go from the end
  while (bar.length > MAX_PINNED) {
    const last = [...bar].reverse().find((id) => !ALWAYS_PINNED.includes(id));
    if (!last) break;
    bar = bar.filter((id) => id !== last);
  }
  return { bar, more: available.filter((id) => !bar.includes(id)) };
}

/** [pinned] with [id] moved to MORE; unchanged for one that always stays. */
export function unpin(pinned: readonly AppDestination[], id: AppDestination): AppDestination[] {
  if (ALWAYS_PINNED.includes(id)) return [...pinned];
  return pinned.filter((other) => other !== id);
}

/**
 * [pinned] with [id] in the bar, before the ones that always stay (they keep
 * the end); null when the bar is full.
 */
export function pin(
  pinned: readonly AppDestination[],
  id: AppDestination,
  available: readonly AppDestination[],
): AppDestination[] | null {
  const { bar } = layoutNav(available, pinned);
  if (bar.includes(id)) return [...bar];
  if (bar.length >= MAX_PINNED) return null;
  const fixedAt = bar.findIndex((other) => ALWAYS_PINNED.includes(other));
  const at = fixedAt < 0 ? bar.length : fixedAt;
  return [...bar.slice(0, at), id, ...bar.slice(at)];
}

/** The saved bar read back; anything broken is the default. */
export function parsePinned(raw: string | null, known: readonly AppDestination[]): AppDestination[] {
  try {
    const value = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(value)) return value.filter((id): id is AppDestination => known.includes(id));
  } catch {
    // The default
  }
  return [...DEFAULT_PINNED];
}
