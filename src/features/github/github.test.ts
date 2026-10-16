import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryGitHub, createNativeGitHub, GitHubError, parseGitHubUrl, REPOS_PER_PAGE } from './github';

const plugin = vi.hoisted(() => ({
  account: vi.fn(),
  startLogin: vi.fn(),
  finishLogin: vi.fn(),
  cancelLogin: vi.fn(),
  logout: vi.fn(),
  openUrl: vi.fn(),
  repos: vi.fn(),
  pullRequestFor: vi.fn(),
  remoteBranches: vi.fn(),
  createPullRequest: vi.fn(),
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

describe('pull requests', () => {
  it('reads owner and repository from a GitHub https URL, and nothing else', () => {
    expect(parseGitHubUrl('https://github.com/EricMaton/pepino-ide.git')).toEqual({
      owner: 'EricMaton',
      repo: 'pepino-ide',
    });
    expect(parseGitHubUrl('https://github.com/octocat/hello')).toEqual({ owner: 'octocat', repo: 'hello' });
    expect(parseGitHubUrl('https://github.com/octocat/hello.js/')).toEqual({ owner: 'octocat', repo: 'hello.js' });
    expect(parseGitHubUrl('https://gitlab.com/octocat/hello.git')).toBeNull();
    expect(parseGitHubUrl('git@github.com:octocat/hello.git')).toBeNull();
    expect(parseGitHubUrl(null)).toBeNull();
  });

  it('the native one asks the plugin, never as a draft, and keeps GitHub’s refusals', async () => {
    const pull = { number: 12, title: 'Add login', url: 'https://github.com/o/r/pull/12', draft: false };
    plugin.pullRequestFor.mockResolvedValue({ defaultBranch: 'main', pullRequest: pull });
    plugin.remoteBranches.mockResolvedValue({ branches: ['main', 'develop'] });
    plugin.createPullRequest.mockResolvedValue({ pullRequest: pull });
    const github = createNativeGitHub('client1');
    const repo = { owner: 'o', repo: 'r' };

    expect(await github.pullRequestFor(repo, 'feature')).toEqual({ defaultBranch: 'main', pullRequest: pull });
    expect(plugin.pullRequestFor).toHaveBeenCalledWith({ owner: 'o', repo: 'r', branch: 'feature' });
    expect(await github.remoteBranches(repo)).toEqual(['main', 'develop']);
    const request = { ...repo, head: 'feature', base: 'main', title: 'Add login', body: '' };
    expect(await github.createPullRequest(request)).toEqual(pull);
    expect(plugin.createPullRequest).toHaveBeenCalledWith({ ...request, draft: false });

    plugin.createPullRequest.mockRejectedValue({
      code: 'INVALID',
      message: 'A pull request already exists for o:feature.',
    });
    await expect(github.createPullRequest(request)).rejects.toMatchObject({
      code: 'INVALID',
      message: 'A pull request already exists for o:feature.',
    });
  });

  it('the stand-in opens one per branch, and refuses a second', async () => {
    const github = createMemoryGitHub(0, 0, 0);
    const repo = { owner: 'octocat', repo: 'hello' };
    await expect(github.pullRequestFor(repo, 'feature')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await github.finishLogin();

    expect(await github.pullRequestFor(repo, 'feature')).toEqual({ defaultBranch: 'main', pullRequest: null });
    const request = { ...repo, head: 'feature', base: 'main', title: 'Add login', body: 'Why' };
    const pull = await github.createPullRequest(request);
    expect(pull).toMatchObject({ number: 1, title: 'Add login' });
    expect((await github.pullRequestFor(repo, 'feature')).pullRequest).toEqual(pull);
    await expect(github.createPullRequest(request)).rejects.toBeInstanceOf(GitHubError);
  });
});
