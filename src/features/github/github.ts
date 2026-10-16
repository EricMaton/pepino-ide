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

export type GitHubErrorCode = 'EXPIRED' | 'DENIED' | 'CANCELLED' | 'DISABLED' | 'UNAUTHORIZED' | 'NETWORK' | 'FAILED';

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
}

const CODES: readonly GitHubErrorCode[] = ['EXPIRED', 'DENIED', 'CANCELLED', 'DISABLED', 'UNAUTHORIZED', 'NETWORK'];

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
    subscribe,
  };
}

/**
 * A stand-in for the web (`npm run dev`) and tests: GitHub's OAuth endpoints
 * do not allow CORS, so the browser cannot sign in for real. Approving takes
 * [approveAfterMs]; the account lives in memory only.
 */
export function createMemoryGitHub(approveAfterMs = 3000): GitHub {
  const { tell, subscribe } = listeners();
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
    subscribe,
  };
}
