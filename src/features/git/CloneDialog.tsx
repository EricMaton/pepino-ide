import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useServices } from '../../app/services';
import { Button, Dialog, TextField } from '../../ui/components';
import { cx } from '../../ui/cx';
import { FolderIcon } from '../../ui/icons';
import { useSnackbar } from '../../ui/useSnackbar';
import type { GitHubError, GitHubRepo } from '../github/github';
import { GitHubLoginDialog } from '../github/GitHubLoginDialog';
import { createRepoPager, matchesQuery, type RepoPager } from '../github/repoPager';
import { useGitHubAccount } from '../github/useGitHubAccount';
import { errorMessage } from '../projects/errors';
import { joinPath } from '../projects/paths';
import { formatAgo } from '../projects/recents';
import { useDirectoryListing } from '../projects/useDirectoryListing';
import styles from './CloneDialog.module.css';
import { type RemoteProgress, GitError } from './engine';
import { LocationDialog } from './LocationDialog';
import { nameError, shown } from './locations';

/*
 * GitHub Desktop's "Clone a repository": pick one of the user's GitHub
 * repositories (#31), say where it goes, and watch it clone (#32). Signed
 * out, the dialog offers to sign in right here.
 */

type Cloning = { kind: 'cloning'; repo: GitHubRepo; path: string; progress: RemoteProgress | null; error: unknown };

type Step = { kind: 'pick' } | { kind: 'where'; repo: GitHubRepo } | Cloning;

export function CloneRepositoryDialog({
  onClose,
  onCloned,
}: {
  onClose: () => void;
  /** The clone is done, at [path], and one of the repositories. */
  onCloned: (path: string) => void;
}) {
  const { github, git, repositories } = useServices();
  const showSnackbar = useSnackbar();
  const account = useGitHubAccount();
  const [signingIn, setSigningIn] = useState(false);
  const [step, setStep] = useState<Step>({ kind: 'pick' });
  const [selected, setSelected] = useState<GitHubRepo | null>(null);
  const [query, setQuery] = useState('');
  // The list, kept while the user says where the clone goes; a new one for another account
  const [list, setList] = useState<{ login: string; pager: RepoPager } | null>(null);
  if (account && list?.login !== account.login) setList({ login: account.login, pager: createRepoPager(github) });

  const clone = (repo: GitHubRepo, path: string) => {
    setStep({ kind: 'cloning', repo, path, progress: null, error: null });
    const update = (change: Partial<Cloning>) =>
      setStep((current) => (current.kind === 'cloning' ? { ...current, ...change } : current));
    git
      .clone(path, repo.cloneUrl, (progress) => update({ progress }))
      .then(async () => {
        await repositories.add(path);
        showSnackbar(`Cloned ${repo.fullName}`);
        onCloned(path);
      })
      .catch((error: unknown) => {
        // cancelled: the dialog closed already
        if (!(error instanceof GitError && error.code === 'CANCELLED')) update({ error });
      });
  };

  // Closing while cloning stops the clone, which leaves nothing behind
  const close = () => {
    if (step.kind === 'cloning' && !step.error) void git.cancelRemote();
    onClose();
  };

  const signIn = () => {
    setStep({ kind: 'pick' });
    setSigningIn(true);
  };

  if (signingIn) {
    // the account updates by itself once signed in, and the list shows
    return <GitHubLoginDialog onClose={() => setSigningIn(false)} onSignedIn={() => setSigningIn(false)} />;
  }
  if (step.kind === 'where') {
    return (
      <WhereDialog
        repo={step.repo}
        onBack={() => setStep({ kind: 'pick' })}
        onClose={close}
        onClone={(path) => clone(step.repo, path)}
      />
    );
  }
  if (step.kind === 'cloning') {
    return (
      <CloningDialog
        step={step}
        onClose={close}
        onRetry={() => clone(step.repo, step.path)}
        onBack={() => setStep({ kind: 'where', repo: step.repo })}
        onSignIn={signIn}
      />
    );
  }

  return (
    <Dialog
      title="Clone a repository"
      eyebrow={account ? `GITHUB · @${account.login}` : 'GITHUB'}
      onClose={close}
      actions={
        <>
          <Button variant="text" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="filled"
            disabled={!selected}
            onClick={() => selected && setStep({ kind: 'where', repo: selected })}
          >
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
          <Button variant="filled" onClick={signIn}>
            Sign in with GitHub
          </Button>
        </div>
      ) : (
        list?.login === account.login && (
          <RepoPicker
            pager={list.pager}
            query={query}
            onQuery={setQuery}
            selected={selected}
            onSelect={setSelected}
            onSignIn={signIn}
          />
        )
      )}
    </Dialog>
  );
}

/** Where the clone goes: a new folder, named after the repository by default, in a folder of ~/projects. */
function WhereDialog({
  repo,
  onBack,
  onClose,
  onClone,
}: {
  repo: GitHubRepo;
  onBack: () => void;
  onClose: () => void;
  onClone: (path: string) => void;
}) {
  const { projectSpace } = useServices();
  const [name, setName] = useState(repo.name);
  const [location, setLocation] = useState('');
  const [choosing, setChoosing] = useState(false);
  const listing = useDirectoryListing(projectSpace, location);
  const taken = new Set(listing?.ok ? listing.entries.map((entry) => entry.name) : []);
  const error = nameError(name, taken, location);
  const valid = name.trim() !== '' && error === null && listing?.ok === true;
  const clone = () => {
    if (valid) onClone(joinPath(location, name.trim()));
  };

  if (choosing) {
    return (
      <LocationDialog
        start={location}
        onClose={() => setChoosing(false)}
        onChoose={(path) => {
          setLocation(path);
          setChoosing(false);
        }}
      />
    );
  }

  return (
    <Dialog
      title={`Clone ${repo.name}`}
      eyebrow={repo.fullName}
      onClose={onClose}
      actions={
        <>
          <Button variant="text" onClick={onBack}>
            Back
          </Button>
          <Button variant="filled" disabled={!valid} onClick={clone}>
            Clone
          </Button>
        </>
      }
    >
      <TextField label="Folder name" value={name} onChange={setName} error={error} onSubmit={clone} />
      <div className={styles.location}>
        <FolderIcon size={20} />
        <span className={styles.locationText}>
          <span className="caption muted">LOCATION</span>
          <span className="body ellipsis">{shown(location)}</span>
        </span>
        <Button variant="text" onClick={() => setChoosing(true)}>
          Change
        </Button>
      </div>
      <p className={cx('caption', 'muted', styles.note)}>
        The whole history comes, with every branch; <strong>{repo.defaultBranch}</strong> is checked out.
      </p>
    </Dialog>
  );
}

/** What went wrong with a clone, said plainly. */
function explainClone(error: unknown): { title: string; detail: string; signIn: boolean } {
  const code = error instanceof GitError ? error.code : null;
  if (code === 'UNAUTHORIZED') {
    return {
      title: 'GitHub refused the sign-in',
      detail: 'It may have been revoked on GitHub. Sign in again, then clone.',
      signIn: true,
    };
  }
  if (code === 'NETWORK') {
    return {
      title: 'The connection dropped',
      detail: 'Nothing was kept: the clone starts over when you try again.',
      signIn: false,
    };
  }
  return { title: 'The clone failed', detail: errorMessage(error), signIn: false };
}

/** The clone under way: the step git is on and how far, or why it failed. */
function CloningDialog({
  step,
  onClose,
  onRetry,
  onBack,
  onSignIn,
}: {
  step: Cloning;
  onClose: () => void;
  onRetry: () => void;
  onBack: () => void;
  onSignIn: () => void;
}) {
  const { progress, error } = step;
  let body: ReactNode;
  let actions: ReactNode;
  if (error) {
    const failure = explainClone(error);
    body = (
      <div className={styles.error} role="alert">
        <p className="body">{failure.title}</p>
        <p className="caption muted">{failure.detail}</p>
      </div>
    );
    actions = (
      <>
        <Button variant="text" onClick={onBack}>
          Back
        </Button>
        <Button variant="filled" onClick={failure.signIn ? onSignIn : onRetry}>
          {failure.signIn ? 'Sign in again' : 'Try again'}
        </Button>
      </>
    );
  } else {
    const percent =
      progress && progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : null;
    body = (
      <div className={styles.cloning}>
        <p className={cx('label', 'cursor', styles.status)} role="status">
          {progress ? progress.task : 'Connecting to GitHub'}
          {percent !== null && ` · ${percent}%`}
        </p>
        <div
          className={cx(styles.bar, percent === null && styles.barUnknown)}
          role="progressbar"
          aria-label="Clone progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? undefined}
        >
          <span style={percent === null ? undefined : { width: `${percent}%` }} />
        </div>
        <p className="caption muted">
          Into {shown(step.path)}. Big repositories take a while: their whole history comes.
        </p>
      </div>
    );
    actions = (
      <Button variant="text" onClick={onClose}>
        Cancel
      </Button>
    );
  }
  return (
    <Dialog title={`Cloning ${step.repo.name}`} eyebrow={step.repo.fullName} onClose={onClose} actions={actions}>
      {body}
    </Dialog>
  );
}

function RepoPicker({
  pager,
  query,
  onQuery,
  selected,
  onSelect,
  onSignIn,
}: {
  pager: RepoPager;
  query: string;
  onQuery: (query: string) => void;
  selected: GitHubRepo | null;
  onSelect: (repo: GitHubRepo) => void;
  onSignIn: () => void;
}) {
  // "3D AGO" counts from when the list opened
  const [now] = useState(() => Date.now());
  const state = useSyncExternalStore(pager.subscribe, pager.state);
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
        <TextField label="Filter" placeholder="owner/name" prefix=">" value={query} onChange={onQuery} />
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
