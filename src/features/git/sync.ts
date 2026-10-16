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

/** The bar's two lines for [state] on [branch]. */
export function describeSync(state: SyncState, branch: string): { title: string; detail: string } {
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
      return { title: 'Fetch origin', detail: `Up to date with ${state.upstream} · check for new commits` };
  }
}
