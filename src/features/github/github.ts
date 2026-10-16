import { registerPlugin } from '@capacitor/core';

/*
 * GitHub sign-in (#29, #30) with the OAuth device flow: Pepino shows a code,
 * the user approves it on github.com, and the native `GitHub` plugin keeps
 * the token encrypted in the Android Keystore. The token never reaches this
 * side: here there is only the code to type and who signed in.
 */

/** Pepino's OAuth app on GitHub (public, like every OAuth client id). */
export const GITHUB_CLIENT_ID = 'Ov23ligFQ5MuzLLOYpw1';

/**
 * What the token may do: `repo` to clone, push and open PRs (private
 * repositories too), `workflow` to push changes to `.github/workflows`,
 * `read:user` for the profile.
 */
export const GITHUB_SCOPES = 'repo workflow read:user';

export interface GitHubAccount {
  login: string;
  name: string | null;
  avatarUrl: string;
}

/** A sign-in waiting for the user: the code to type at [verificationUri]. */
export interface DeviceLogin {
  userCode: string;
  verificationUri: string;
  /** Seconds the code lasts. */
  expiresIn: number;
}

/** A repository the user can clone (#31). */
export interface GitHubRepo {
  /** `owner/name`. */
  fullName: string;
  name: string;
  owner: string;
  description: string | null;
  private: boolean;
  fork: boolean;
  archived: boolean;
  defaultBranch: string;
  cloneUrl: string;
  language: string | null;
  /** ISO time of the last push; null for an empty repository. */
  pushedAt: string | null;
}

/** A page of repositories, and whether GitHub has more after it. */
export interface RepoPage {
  repos: GitHubRepo[];
  hasMore: boolean;
}

/** Repositories per page: big enough that most people have one or two. */
export const REPOS_PER_PAGE = 50;

export type GitHubErrorCode =
  'EXPIRED' | 'DENIED' | 'CANCELLED' | 'DISABLED' | 'UNAUTHORIZED' | 'RATE_LIMITED' | 'NETWORK' | 'FAILED';

export class GitHubError extends Error {
  constructor(
    readonly code: GitHubErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

export interface GitHub {
  /** Who is signed in, as last seen (no network); null when signed out. */
  account(): Promise<GitHubAccount | null>;
  /** Starts signing in: the code for the user to type on GitHub. */
  startLogin(): Promise<DeviceLogin>;
  /** Waits until the user approves the code on GitHub, and keeps the token. */
  finishLogin(): Promise<GitHubAccount>;
  /** Stops waiting: [finishLogin] rejects with CANCELLED. */
  cancelLogin(): Promise<void>;
  /** Forgets the token and the account. */
  logout(): Promise<void>;
  /** Opens an https link in the browser. */
  openUrl(url: string): Promise<void>;
  /** [page] (from 1) of the signed-in user's repositories, most recently pushed first. */
  repos(page: number): Promise<RepoPage>;
  /** Called whenever someone signs in or out; returns the unsubscribe. */
  subscribe(listener: (account: GitHubAccount | null) => void): () => void;
}

interface GitHubPlugin {
  account(): Promise<{ account: GitHubAccount | null }>;
  startLogin(options: { clientId: string; scopes: string }): Promise<DeviceLogin>;
  finishLogin(): Promise<{ account: GitHubAccount }>;
  cancelLogin(): Promise<void>;
  logout(): Promise<void>;
  openUrl(options: { url: string }): Promise<void>;
  repos(options: { page: number; perPage: number }): Promise<RepoPage>;
}

const CODES: readonly GitHubErrorCode[] = [
  'EXPIRED',
  'DENIED',
  'CANCELLED',
  'DISABLED',
  'UNAUTHORIZED',
  'RATE_LIMITED',
  'NETWORK',
];

/** A plugin rejection as a [GitHubError]. */
function githubError(error: unknown): GitHubError {
  const { code, message } = (error ?? {}) as { code?: string; message?: string };
  const known = CODES.find((candidate) => candidate === code);
  return new GitHubError(known ?? 'FAILED', message ?? 'GitHub sign-in failed');
}

/** Account changes, told to whoever listens. */
function listeners() {
  const all = new Set<(account: GitHubAccount | null) => void>();
  return {
    tell: (account: GitHubAccount | null) => all.forEach((listener) => listener(account)),
    subscribe: (listener: (account: GitHubAccount | null) => void) => {
      all.add(listener);
      return () => void all.delete(listener);
    },
  };
}

export function createNativeGitHub(clientId = GITHUB_CLIENT_ID, scopes = GITHUB_SCOPES): GitHub {
  const plugin = registerPlugin<GitHubPlugin>('GitHub');
  const { tell, subscribe } = listeners();
  const call = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      throw githubError(error);
    }
  };
  return {
    account: () => call(async () => (await plugin.account()).account),
    startLogin: () => call(() => plugin.startLogin({ clientId, scopes })),
    finishLogin: () =>
      call(async () => {
        const { account } = await plugin.finishLogin();
        tell(account);
        return account;
      }),
    cancelLogin: () => call(() => plugin.cancelLogin()),
    logout: () =>
      call(async () => {
        await plugin.logout();
        tell(null);
      }),
    openUrl: (url) => call(() => plugin.openUrl({ url })),
    repos: (page) => call(() => plugin.repos({ page, perPage: REPOS_PER_PAGE })),
    subscribe,
  };
}

/** [count] made-up repositories for the web stand-in, most recently pushed first. */
function sampleRepos(owner: string, count: number): GitHubRepo[] {
  const languages = ['TypeScript', 'Kotlin', 'Python', null];
  return Array.from({ length: count }, (_, index) => {
    const name = index === 0 ? 'pepino-ide' : `project-${String(index).padStart(3, '0')}`;
    return {
      fullName: `${owner}/${name}`,
      name,
      owner,
      description: index % 3 === 0 ? null : `Sample repository number ${index}`,
      private: index % 4 === 1,
      fork: index % 7 === 3,
      archived: index % 11 === 5,
      defaultBranch: 'main',
      cloneUrl: `https://github.com/${owner}/${name}.git`,
      language: languages[index % languages.length],
      pushedAt: index % 13 === 12 ? null : new Date(Date.UTC(2026, 9, 16) - index * 86_400_000).toISOString(),
    };
  });
}

/**
 * A stand-in for the web (`npm run dev`) and tests: GitHub's OAuth endpoints
 * do not allow CORS, so the browser cannot sign in for real. Approving takes
 * [approveAfterMs]; the account lives in memory only, with [repoCount]
 * made-up repositories that take [latencyMs] a page.
 */
export function createMemoryGitHub(approveAfterMs = 3000, repoCount = 120, latencyMs = 400): GitHub {
  const { tell, subscribe } = listeners();
  const allRepos = sampleRepos('octocat', repoCount);
  let account: GitHubAccount | null = null;
  let waiting: { cancel: () => void } | null = null;
  return {
    account: async () => account,
    startLogin: async () => ({
      userCode: 'WDJB-MJHT',
      verificationUri: 'https://github.com/login/device',
      expiresIn: 900,
    }),
    finishLogin: () =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting = null;
          account = { login: 'octocat', name: 'The Octocat', avatarUrl: '' };
          tell(account);
          resolve(account);
        }, approveAfterMs);
        waiting = {
          cancel: () => {
            clearTimeout(timer);
            reject(new GitHubError('CANCELLED', 'Sign-in cancelled'));
          },
        };
      }),
    cancelLogin: async () => {
      waiting?.cancel();
      waiting = null;
    },
    logout: async () => {
      account = null;
      tell(null);
    },
    openUrl: async (url) => void window.open(url, '_blank', 'noopener'),
    repos: async (page) => {
      if (!account) throw new GitHubError('UNAUTHORIZED', 'Not signed in to GitHub');
      await new Promise((resolve) => setTimeout(resolve, latencyMs));
      const from = (page - 1) * REPOS_PER_PAGE;
      return { repos: allRepos.slice(from, from + REPOS_PER_PAGE), hasMore: from + REPOS_PER_PAGE < allRepos.length };
    },
    subscribe,
  };
}
