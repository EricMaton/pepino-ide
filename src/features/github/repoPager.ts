import { type GitHub, GitHubError, type GitHubRepo } from './github';

/*
 * The user's repositories (#31), a page at a time: the list asks for more
 * when its end shows up, and a search asks for every page, since GitHub
 * cannot search all of a user's repositories (their own, collaborations and
 * organizations) in one query.
 */

export interface RepoListState {
  repos: readonly GitHubRepo[];
  /** Whether GitHub has pages not read yet. */
  hasMore: boolean;
  loading: boolean;
  /** Why the last page could not be read; [RepoPager.loadMore] tries again. */
  error: GitHubError | null;
}

export interface RepoPager {
  state(): RepoListState;
  /** Reads the next page, unless one is on its way or there are no more. */
  loadMore(): Promise<void>;
  subscribe(listener: () => void): () => void;
}

export function createRepoPager(github: GitHub): RepoPager {
  let state: RepoListState = { repos: [], hasMore: true, loading: false, error: null };
  let page = 0;
  const listeners = new Set<() => void>();
  const set = (next: Partial<RepoListState>) => {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
  };
  return {
    state: () => state,
    loadMore: async () => {
      if (state.loading || !state.hasMore) return;
      set({ loading: true, error: null });
      try {
        const next = await github.repos(page + 1);
        page += 1;
        // A push between two pages moves a repository up (the order is by push): it may come twice
        const seen = new Set(state.repos.map((repo) => repo.fullName));
        set({
          repos: [...state.repos, ...next.repos.filter((repo) => !seen.has(repo.fullName))],
          hasMore: next.hasMore,
          loading: false,
        });
      } catch (error) {
        set({
          loading: false,
          error: error instanceof GitHubError ? error : new GitHubError('FAILED', String(error)),
        });
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

/** Whether [repo] matches every word of [query], in its owner/name, ignoring case. */
export function matchesQuery(repo: GitHubRepo, query: string): boolean {
  const name = repo.fullName.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => name.includes(word));
}
