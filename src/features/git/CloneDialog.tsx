import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useServices } from '../../app/services';
import { Button, Dialog, TextField } from '../../ui/components';
import { cx } from '../../ui/cx';
import type { GitHubError, GitHubRepo } from '../github/github';
import { GitHubLoginDialog } from '../github/GitHubLoginDialog';
import { createRepoPager, matchesQuery } from '../github/repoPager';
import { useGitHubAccount } from '../github/useGitHubAccount';
import { formatAgo } from '../projects/recents';
import styles from './CloneDialog.module.css';

/**
 * GitHub Desktop's "Clone a repository": the user's GitHub repositories
 * (#31), most recently pushed first, with a filter. Signed out, it offers to
 * sign in right here. Cloning the one picked is #32.
 */
export function CloneRepositoryDialog({ onClose }: { onClose: () => void }) {
  const account = useGitHubAccount();
  const [signingIn, setSigningIn] = useState(false);
  const [selected, setSelected] = useState<GitHubRepo | null>(null);

  if (signingIn) {
    // the account updates by itself once signed in, and the list shows
    return <GitHubLoginDialog onClose={() => setSigningIn(false)} onSignedIn={() => setSigningIn(false)} />;
  }

  return (
    <Dialog
      title="Clone a repository"
      eyebrow={account ? `GITHUB · @${account.login}` : 'GITHUB'}
      onClose={onClose}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          {/* Cloning (#32) comes next */}
          <Button variant="filled" disabled>
            Clone
          </Button>
        </>
      }
    >
      {account === undefined ? (
        <span hidden data-loading />
      ) : account === null ? (
        <div className={styles.signIn}>
          <p className="body">Sign in to GitHub to see your repositories, private ones too.</p>
          <Button variant="filled" onClick={() => setSigningIn(true)}>
            Sign in with GitHub
          </Button>
        </div>
      ) : (
        <RepoPicker
          key={account.login}
          selected={selected}
          onSelect={setSelected}
          onSignIn={() => setSigningIn(true)}
        />
      )}
    </Dialog>
  );
}

function RepoPicker({
  selected,
  onSelect,
  onSignIn,
}: {
  selected: GitHubRepo | null;
  onSelect: (repo: GitHubRepo) => void;
  onSignIn: () => void;
}) {
  const { github } = useServices();
  const [pager] = useState(() => createRepoPager(github));
  // "3D AGO" counts from when the list opened
  const [now] = useState(() => Date.now());
  const state = useSyncExternalStore(pager.subscribe, pager.state);
  const [query, setQuery] = useState('');
  const words = query.trim();
  const shown = words === '' ? state.repos : state.repos.filter((repo) => matchesQuery(repo, words));
  const end = useRef<HTMLDivElement>(null);

  // The first page; while filtering, every page (until one fails: then the user retries)
  useEffect(() => {
    if (state.error || state.loading || !state.hasMore) return;
    if (state.repos.length === 0 || words !== '') void pager.loadMore();
  }, [pager, state, words]);

  // The next page once the end of the list shows (observed anew after each page, as it may still show)
  useEffect(() => {
    const node = end.current;
    if (!node || !state.hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !pager.state().error) void pager.loadMore();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [pager, state.repos.length, state.hasMore]);

  return (
    <div className={styles.picker}>
      <div className={styles.filter}>
        <TextField label="Filter" placeholder="owner/name" prefix=">" value={query} onChange={setQuery} />
      </div>
      {shown.length > 0 && (
        <div className={styles.list} role="listbox" aria-label="Your GitHub repositories">
          {shown.map((repo) => (
            <RepoRow
              key={repo.fullName}
              repo={repo}
              now={now}
              selected={repo.fullName === selected?.fullName}
              onSelect={() => onSelect(repo)}
            />
          ))}
        </div>
      )}
      <div ref={end} className={styles.end}>
        {state.error ? (
          <ListError error={state.error} onRetry={() => void pager.loadMore()} onSignIn={onSignIn} />
        ) : state.loading || state.hasMore ? (
          <p className={cx('label', 'cursor', styles.status)} data-loading>
            {words === '' ? 'Loading repositories' : 'Searching all your repositories'}
          </p>
        ) : shown.length === 0 ? (
          <p className={cx('caption', 'muted', styles.status)}>
            {words === '' ? 'No repositories on GitHub yet.' : `No repository matches “${words}”.`}
          </p>
        ) : (
          <p className={cx('caption', 'muted', styles.status)}>
            {words === ''
              ? `${state.repos.length} repositories`
              : `${shown.length} of ${state.repos.length} repositories`}
          </p>
        )}
      </div>
    </div>
  );
}

function RepoRow({
  repo,
  now,
  selected,
  onSelect,
}: {
  repo: GitHubRepo;
  now: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const tags = [
    repo.private && 'PRIVATE',
    repo.fork && 'FORK',
    repo.archived && 'ARCHIVED',
    repo.language,
    repo.pushedAt ? formatAgo(Date.parse(repo.pushedAt), now) : 'EMPTY',
  ].filter(Boolean);
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={cx(styles.row, selected && styles.rowSelected)}
      onClick={onSelect}
    >
      <span className={cx('body', 'ellipsis', styles.name)}>
        <span className="muted">{repo.owner}/</span>
        {repo.name}
      </span>
      {repo.description && <span className="caption muted ellipsis">{repo.description}</span>}
      <span className={cx('caption', 'ellipsis', styles.tags)}>{tags.join(' · ')}</span>
    </button>
  );
}

function ListError({ error, onRetry, onSignIn }: { error: GitHubError; onRetry: () => void; onSignIn: () => void }) {
  const [title, detail] =
    error.code === 'UNAUTHORIZED'
      ? ['GitHub no longer accepts your sign-in', 'It may have been revoked on GitHub. Sign in again.']
      : error.code === 'NETWORK'
        ? ['No connection to GitHub', 'Check the connection and try again.']
        : error.code === 'RATE_LIMITED'
          ? ['GitHub asks to wait', error.message]
          : ['Cannot read your repositories', error.message];
  return (
    <div className={styles.error} role="alert">
      <p className="body">{title}</p>
      <p className="caption muted">{detail}</p>
      {error.code === 'UNAUTHORIZED' ? (
        <Button variant="outlined" onClick={onSignIn}>
          Sign in again
        </Button>
      ) : (
        <Button variant="outlined" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
