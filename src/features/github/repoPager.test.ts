import { describe, expect, it, vi } from 'vitest';
import { createMemoryGitHub, type GitHub, GitHubError, type GitHubRepo, type RepoPage } from './github';
import { createRepoPager, matchesQuery } from './repoPager';

const repo = (fullName: string): GitHubRepo => ({
  fullName,
  name: fullName.split('/')[1],
  owner: fullName.split('/')[0],
  description: null,
  private: false,
  fork: false,
  archived: false,
  defaultBranch: 'main',
  cloneUrl: `https://github.com/${fullName}.git`,
  language: null,
  pushedAt: null,
});

/** A GitHub whose pages are [pages], in order; a GitHubError in their place is thrown. */
function pagedGitHub(pages: (RepoPage | GitHubError)[]): GitHub & { asked: number[] } {
  const asked: number[] = [];
  const github = createMemoryGitHub();
  return {
    ...github,
    asked,
    repos: vi.fn(async (page: number) => {
      asked.push(page);
      const next = pages.shift();
      if (!next) throw new Error('no more pages');
      if (next instanceof GitHubError) throw next;
      return next;
    }),
  };
}

describe('repo pager', () => {
  it('reads page after page until GitHub has no more', async () => {
    const github = pagedGitHub([
      { repos: [repo('a/one'), repo('a/two')], hasMore: true },
      { repos: [repo('b/three')], hasMore: false },
    ]);
    const pager = createRepoPager(github);
    const seen = vi.fn();
    pager.subscribe(seen);

    await pager.loadMore();
    expect(pager.state()).toMatchObject({ hasMore: true, loading: false });
    await pager.loadMore();
    await pager.loadMore(); // nothing left: no request

    expect(github.asked).toEqual([1, 2]);
    expect(pager.state().repos.map((r) => r.fullName)).toEqual(['a/one', 'a/two', 'b/three']);
    expect(pager.state().hasMore).toBe(false);
    expect(seen).toHaveBeenCalled();
  });

  it('asks for one page at a time', async () => {
    const github = pagedGitHub([{ repos: [repo('a/one')], hasMore: true }]);
    const pager = createRepoPager(github);
    const first = pager.loadMore();
    expect(pager.state().loading).toBe(true);
    await pager.loadMore();
    await first;
    expect(github.asked).toEqual([1]);
  });

  it('keeps a repository once when a push moved it to the next page', async () => {
    const github = pagedGitHub([
      { repos: [repo('a/one'), repo('a/two')], hasMore: true },
      { repos: [repo('a/two'), repo('a/three')], hasMore: false },
    ]);
    const pager = createRepoPager(github);
    await pager.loadMore();
    await pager.loadMore();
    expect(pager.state().repos.map((r) => r.fullName)).toEqual(['a/one', 'a/two', 'a/three']);
  });

  it('keeps what it has on an error, and the same page is tried again', async () => {
    const github = pagedGitHub([
      { repos: [repo('a/one')], hasMore: true },
      new GitHubError('NETWORK', 'Cannot reach GitHub'),
      { repos: [repo('a/two')], hasMore: false },
    ]);
    const pager = createRepoPager(github);
    await pager.loadMore();
    await pager.loadMore();
    expect(pager.state().error?.code).toBe('NETWORK');
    expect(pager.state().repos).toHaveLength(1);

    await pager.loadMore();
    expect(github.asked).toEqual([1, 2, 2]);
    expect(pager.state().error).toBeNull();
    expect(pager.state().repos).toHaveLength(2);
  });
});

describe('matchesQuery', () => {
  it('matches every word in owner/name, ignoring case', () => {
    const pepino = repo('EricMaton/pepino-ide');
    expect(matchesQuery(pepino, '')).toBe(true);
    expect(matchesQuery(pepino, 'PEPINO')).toBe(true);
    expect(matchesQuery(pepino, 'eric ide')).toBe(true);
    expect(matchesQuery(pepino, 'maton/pep')).toBe(true);
    expect(matchesQuery(pepino, 'pepino web')).toBe(false);
  });
});

describe('memory GitHub repos', () => {
  it('pages its sample repositories once signed in', async () => {
    const github = createMemoryGitHub(0, 120, 0);
    await expect(github.repos(1)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await github.finishLogin();
    const first = await github.repos(1);
    const last = await github.repos(3);
    expect(first).toMatchObject({ hasMore: true });
    expect(first.repos).toHaveLength(50);
    expect(last).toMatchObject({ hasMore: false });
    expect(last.repos).toHaveLength(20);
  });
});
