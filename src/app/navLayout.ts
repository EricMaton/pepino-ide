import type { AppDestination } from './destinations';

/*
 * The bottom bar (#171): the destinations in the bar, and ⋯ MORE with the
 * rest (native screens, and later the plugins' own), both in the user's
 * order. Holding a destination and dragging it moves it: along the bar, into
 * MORE, or from MORE into the bar. SETTINGS always stays in the bar.
 */

/** At most this many in the bar, MORE aside. */
export const MAX_PINNED = 4;

/** Never moved to MORE. */
export const ALWAYS_PINNED: readonly AppDestination[] = ['settings'];

/** The user's arrangement: the bar's order, and MORE's. */
export interface NavOrder {
  bar: AppDestination[];
  more: AppDestination[];
}

export const DEFAULT_ORDER: NavOrder = { bar: ['projects', 'git', 'terminal', 'settings'], more: [] };

export const NAV_ORDER_KEY = 'pepino.nav.order';

/** Where each available destination is, in order: MORE shows only when it has any. */
export interface NavLayout {
  bar: AppDestination[];
  more: AppDestination[];
}

/** [available] (in the app's order) laid out by the user's [order]. */
export function layoutNav(available: readonly AppDestination[], order: NavOrder): NavLayout {
  const unique = (list: readonly AppDestination[]) =>
    list.filter((id, i) => available.includes(id) && list.indexOf(id) === i);
  let bar = unique(order.bar);
  for (const id of ALWAYS_PINNED) if (available.includes(id) && !bar.includes(id)) bar.push(id);
  // Too many (a saved order from a wider bar): the ones that may go, go from the end
  while (bar.length > MAX_PINNED) {
    const last = [...bar].reverse().find((id) => !ALWAYS_PINNED.includes(id));
    if (!last) break;
    bar = bar.filter((id) => id !== last);
  }
  const more = unique(order.more).filter((id) => !bar.includes(id));
  // New destinations (or ones never arranged) join MORE in the app's order
  for (const id of available) if (!bar.includes(id) && !more.includes(id)) more.push(id);
  return { bar, more };
}

/** Where a dragged destination is dropped: before position [index] of that list, counted without it. */
export interface NavDrop {
  zone: 'bar' | 'more';
  index: number;
}

export type NavMove = { order: NavOrder; displaced?: AppDestination } | { refused: 'always-pinned' };

/**
 * [id] dropped at [drop]. Into a full bar, it takes the place of the one it
 * lands next to, which goes to MORE where [id] was (a swap); never one that
 * always stays. SETTINGS can move along the bar, not out of it.
 */
export function moveDestination(
  available: readonly AppDestination[],
  order: NavOrder,
  id: AppDestination,
  drop: NavDrop,
): NavMove {
  const { bar, more } = layoutNav(available, order);
  if (drop.zone === 'more' && ALWAYS_PINNED.includes(id)) return { refused: 'always-pinned' };
  const wasAt = more.indexOf(id);
  const nextBar = bar.filter((other) => other !== id);
  const nextMore = more.filter((other) => other !== id);
  const clamp = (index: number, length: number) => Math.max(0, Math.min(index, length));

  if (drop.zone === 'more') {
    nextMore.splice(clamp(drop.index, nextMore.length), 0, id);
    return { order: { bar: nextBar, more: nextMore } };
  }

  const at = clamp(drop.index, nextBar.length);
  nextBar.splice(at, 0, id);
  if (nextBar.length <= MAX_PINNED) return { order: { bar: nextBar, more: nextMore } };
  // Full: the nearest neighbour that may go makes room
  let displaced: AppDestination | undefined;
  for (let distance = 1; distance < nextBar.length && !displaced; distance++) {
    for (const candidate of [nextBar[at + distance], nextBar[at - distance]]) {
      if (candidate && !ALWAYS_PINNED.includes(candidate)) {
        displaced = candidate;
        break;
      }
    }
  }
  if (!displaced) return { order: { bar, more } };
  nextMore.splice(wasAt < 0 ? 0 : clamp(wasAt, nextMore.length), 0, displaced);
  return { order: { bar: nextBar.filter((other) => other !== displaced), more: nextMore }, displaced };
}

/** The saved arrangement read back; anything broken or unknown is left out (the default when nothing is). */
export function parseNavOrder(raw: string | null, known: readonly AppDestination[]): NavOrder {
  const ids = (value: unknown): AppDestination[] =>
    Array.isArray(value) ? value.filter((id): id is AppDestination => known.includes(id)) : [];
  try {
    const value = raw ? (JSON.parse(raw) as unknown) : null;
    if (value && typeof value === 'object' && 'bar' in value) {
      const saved = value as { bar?: unknown; more?: unknown };
      return { bar: ids(saved.bar), more: ids(saved.more) };
    }
  } catch {
    // The default
  }
  return { bar: [...DEFAULT_ORDER.bar], more: [...DEFAULT_ORDER.more] };
}
