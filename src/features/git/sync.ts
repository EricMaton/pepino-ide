import { formatAgo } from '../projects/recents';
import type { SyncState } from './engine';

/* What the sync bar (#33) offers, and how it says it. */

export type Action = 'publish' | 'pull' | 'push' | 'fetch';

/** What the bar offers for [state]. */
export function syncAction(state: SyncState): Action {
  if (!state.upstream) return 'publish';
  if (state.behind > 0) return 'pull';
  if (state.ahead > 0) return 'push';
  return 'fetch';
}

export const commits = (count: number) => `${count} commit${count === 1 ? '' : 's'}`;

/** "2026-10-17 09:05", in the device's time zone. */
export function formatStamp(millis: number): string {
  const date = new Date(millis);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** "Last fetched 5m ago", "Never fetched" (#35): how old the counts are. */
export function lastFetchedText(lastFetched: number | null, now: number): string {
  if (lastFetched === null) return 'Never fetched';
  const ago = formatAgo(lastFetched, now).toLowerCase();
  return /^\d{4}-/.test(ago) ? `Last fetched on ${ago}` : `Last fetched ${ago}`;
}

/** The bar's two lines for [state] on [branch]; [now] dates the last fetch. */
export function describeSync(state: SyncState, branch: string, now: number): { title: string; detail: string } {
  switch (syncAction(state)) {
    case 'publish':
      return { title: 'Publish branch', detail: `${branch} is not on GitHub yet` };
    case 'pull':
      return {
        title: 'Pull origin',
        detail: `${commits(state.behind)} on GitHub to bring${state.ahead > 0 ? ` · ${state.ahead} to push after` : ''}`,
      };
    case 'push':
      return { title: 'Push origin', detail: `${commits(state.ahead)} to send to ${state.upstream}` };
    case 'fetch':
      return { title: 'Fetch origin', detail: lastFetchedText(state.lastFetched, now) };
  }
}
