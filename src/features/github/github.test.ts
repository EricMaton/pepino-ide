import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryGitHub, createNativeGitHub, GitHubError, REPOS_PER_PAGE } from './github';

const plugin = vi.hoisted(() => ({
  account: vi.fn(),
  startLogin: vi.fn(),
  finishLogin: vi.fn(),
  cancelLogin: vi.fn(),
  logout: vi.fn(),
  openUrl: vi.fn(),
  repos: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({ registerPlugin: () => plugin }));

const octocat = { login: 'octocat', name: null, avatarUrl: 'https://avatars/1' };

beforeEach(() => vi.clearAllMocks());

describe('native GitHub', () => {
  it('starts the device flow with Pepino’s client id and scopes', async () => {
    plugin.startLogin.mockResolvedValue({
      userCode: 'WDJB-MJHT',
      verificationUri: 'https://github.com/login/device',
      expiresIn: 900,
    });
    const github = createNativeGitHub('client1', 'repo read:user');
    expect(await github.startLogin()).toMatchObject({ userCode: 'WDJB-MJHT' });
    expect(plugin.startLogin).toHaveBeenCalledWith({ clientId: 'client1', scopes: 'repo read:user' });
  });

  it('asks the plugin for a page of repositories, REPOS_PER_PAGE at a time', async () => {
    plugin.repos.mockResolvedValue({ repos: [], hasMore: false });
    await createNativeGitHub('client1').repos(3);
    expect(plugin.repos).toHaveBeenCalledWith({ page: 3, perPage: REPOS_PER_PAGE });

    plugin.repos.mockRejectedValue({ code: 'RATE_LIMITED', message: 'Too many requests' });
    await expect(createNativeGitHub('client1').repos(1)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('tells listeners who signed in and when they sign out', async () => {
    plugin.finishLogin.mockResolvedValue({ account: octocat });
    plugin.logout.mockResolvedValue(undefined);
    const github = createNativeGitHub('client1');
    const listener = vi.fn();
    const unsubscribe = github.subscribe(listener);

    expect(await github.finishLogin()).toEqual(octocat);
    await github.logout();
    unsubscribe();
    await github.logout();

    expect(listener.mock.calls).toEqual([[octocat], [null]]);
  });

  it('turns plugin rejections into GitHubErrors with their code', async () => {
    const github = createNativeGitHub('client1');
    for (const code of ['EXPIRED', 'DENIED', 'CANCELLED', 'DISABLED', 'NETWORK'] as const) {
      plugin.finishLogin.mockRejectedValueOnce({ code, message: `it was ${code}` });
      const error = await github.finishLogin().catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(GitHubError);
      expect(error).toMatchObject({ code, message: `it was ${code}` });
    }
    plugin.account.mockRejectedValueOnce(new Error('weird'));
    await expect(github.account()).rejects.toMatchObject({ code: 'FAILED', message: 'weird' });
  });

  it('unwraps the cached account', async () => {
    plugin.account.mockResolvedValue({ account: null });
    expect(await createNativeGitHub('client1').account()).toBeNull();
  });
});

describe('memory GitHub (web stand-in)', () => {
  it('signs in after a moment, and can be cancelled', async () => {
    vi.useFakeTimers();
    const github = createMemoryGitHub(1000);
    expect(await github.account()).toBeNull();

    const cancelled = github.finishLogin();
    await github.cancelLogin();
    await expect(cancelled).rejects.toMatchObject({ code: 'CANCELLED' });

    const signingIn = github.finishLogin();
    await vi.advanceTimersByTimeAsync(1000);
    expect((await signingIn).login).toBe('octocat');
    expect(await github.account()).toMatchObject({ login: 'octocat' });
    await github.logout();
    expect(await github.account()).toBeNull();
    vi.useRealTimers();
  });
});
