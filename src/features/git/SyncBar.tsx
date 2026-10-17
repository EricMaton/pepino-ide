import { type ReactNode, useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import { Button, Dialog } from '../../ui/components';
import { cx } from '../../ui/cx';
import { CloseIcon, FetchIcon, HistoryIcon, PullIcon, PushIcon } from '../../ui/icons';
import { useSnackbar } from '../../ui/useSnackbar';
import { GitHubLoginDialog } from '../github/GitHubLoginDialog';
import { errorMessage } from '../projects/errors';
import { GitError, type RemoteProgress, type SyncState } from './engine';
import { PullRequestRow } from './PullRequest';
import { type Action, commits, describeSync, syncAction } from './sync';
import styles from './SyncBar.module.css';
import { SyncStatusDialog } from './SyncStatus';

/*
 * GitHub Desktop's sync button (#33), as a bar under the repository and
 * branch: one action at a time, the one that fits. Publish a branch not on
 * GitHub yet; pull when GitHub has commits this branch does not (first, even
 * when there are some to push too); push when this branch has commits
 * GitHub does not; otherwise fetch, to find out. Counts are as of the last
 * fetch, which the bar says when it was. The button at its end opens the
 * sync status screen (#35): the commits behind the counts.
 */

/** How often "Last fetched 5m ago" is brought up to date. */
const CLOCK_MS = 30_000;

/** A refusal that needs more than a snackbar: what happened, and what to do. */
type Problem = { kind: 'conflict' | 'inTheWay' | 'rejected'; paths: readonly string[] } | { kind: 'signIn' };

export function SyncBar({
  path,
  branch,
  refreshKey,
  onPulled,
}: {
  /** The repository (the active project). */
  path: string;
  branch: string;
  /** Changes after a commit or a branch switch: the counts are read again. */
  refreshKey: number;
  /** A pull rewrote files and added commits: changes and history to read again. */
  onPulled: () => void;
}) {
  const { git } = useServices();
  const showSnackbar = useSnackbar();
  const [state, setState] = useState<SyncState | null>(null);
  const [busy, setBusy] = useState<{ action: Action; progress: RemoteProgress | null } | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [showingStatus, setShowingStatus] = useState(false);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    git.sync(path).then(
      (found) => active && setState(found),
      () => active && setState(null),
    );
    return () => {
      active = false;
    };
  }, [git, path, branch, refreshKey]);

  if (!state?.remote) return null;

  const run = async (action: Action) => {
    setBusy({ action, progress: null });
    setNow(Date.now());
    const onProgress = (progress: RemoteProgress) => setBusy({ action, progress });
    try {
      const before = state;
      if (action === 'fetch') {
        const after = await git.fetch(path, onProgress);
        setState(after);
        showSnackbar(after.behind > before.behind ? `${commits(after.behind)} new on GitHub` : 'Up to date');
      } else if (action === 'pull') {
        const after = await git.pull(path, onProgress);
        setState(after);
        onPulled();
        showSnackbar(`Pulled ${commits(before.behind)} from ${before.upstream}`);
      } else {
        const after = await git.push(path, onProgress);
        setState(after);
        showSnackbar(action === 'publish' ? `Published ${branch} to GitHub` : `Pushed to ${after.upstream}`);
      }
    } catch (error) {
      const code = error instanceof GitError ? error.code : null;
      const paths = error instanceof GitError ? error.paths : [];
      if (code === 'MERGE_CONFLICT') setProblem({ kind: 'conflict', paths });
      else if (code === 'CONFLICT') setProblem({ kind: 'inTheWay', paths });
      else if (code === 'REJECTED') setProblem({ kind: 'rejected', paths: [] });
      else if (code === 'UNAUTHORIZED') setProblem({ kind: 'signIn' });
      else if (code === 'NETWORK') showSnackbar('No connection to GitHub');
      else if (code !== 'CANCELLED') showSnackbar(`Error: ${errorMessage(error)}`);
      // A fetch may have happened before the refusal: the counts to show are GitHub's now
      git.sync(path).then(setState, () => undefined);
    } finally {
      setBusy(null);
      setNow(Date.now());
    }
  };

  const action = syncAction(state);
  const { title, detail } = describeSync(state, branch, now);
  const icon =
    action === 'pull' ? <PullIcon size={20} /> : action === 'fetch' ? <FetchIcon size={20} /> : <PushIcon size={20} />;
  const percent =
    busy?.progress && busy.progress.total > 0
      ? Math.min(100, Math.round((busy.progress.done / busy.progress.total) * 100))
      : null;

  return (
    <>
      <div className={styles.bar}>
        {busy ? (
          <div className={styles.busy} role="status">
            <span className={cx('label', 'cursor', 'ellipsis', styles.task)}>
              {busy.progress?.task ?? 'Connecting to GitHub'}
              {percent !== null && ` · ${percent}%`}
            </span>
            <span className={cx(styles.track, percent === null && styles.trackUnknown)} aria-hidden>
              <span style={percent === null ? undefined : { width: `${percent}%` }} />
            </span>
            <Button variant="text" square aria-label="Cancel" onClick={() => void git.cancelRemote()}>
              <CloseIcon size={18} />
            </Button>
          </div>
        ) : (
          <>
            <button type="button" className={styles.action} onClick={() => void run(action)}>
              {icon}
              <span className={styles.text}>
                <span className={cx('body', 'ellipsis', styles.title)}>{title}</span>
                <span className="caption muted ellipsis">{detail}</span>
              </span>
            </button>
            <button
              type="button"
              className={styles.statusButton}
              aria-label={`Sync status: ${state.behind} to pull, ${state.ahead} to push`}
              onClick={() => setShowingStatus(true)}
            >
              {state.ahead > 0 || state.behind > 0 ? (
                <span className={cx('caption', styles.counts)} aria-hidden>
                  {state.behind > 0 && <span>↓{state.behind}</span>}
                  {state.ahead > 0 && <span>↑{state.ahead}</span>}
                </span>
              ) : (
                <HistoryIcon size={20} />
              )}
            </button>
          </>
        )}
      </div>
      <PullRequestRow path={path} branch={branch} state={state} />
      {showingStatus && (
        <SyncStatusDialog
          path={path}
          branch={branch}
          state={state}
          action={action}
          now={now}
          onClose={() => setShowingStatus(false)}
          onRun={() => {
            setShowingStatus(false);
            void run(action);
          }}
        />
      )}
      {problem && (
        <ProblemDialog
          problem={problem}
          upstream={state.upstream}
          onClose={() => setProblem(null)}
          onPull={() => {
            setProblem(null);
            void run('pull');
          }}
          onSignedIn={() => {
            setProblem(null);
            void run(action);
          }}
        />
      )}
    </>
  );
}

/** A file list, the first few names and how many more. */
function Files({ paths }: { paths: readonly string[] }) {
  const shown = paths.slice(0, 6);
  return (
    <ul className={styles.files}>
      {shown.map((file) => (
        <li key={file} className="body ellipsis">
          {file}
        </li>
      ))}
      {paths.length > shown.length && <li className="caption muted">and {paths.length - shown.length} more</li>}
    </ul>
  );
}

function ProblemDialog({
  problem,
  upstream,
  onClose,
  onPull,
  onSignedIn,
}: {
  problem: Problem;
  upstream: string | null;
  onClose: () => void;
  onPull: () => void;
  onSignedIn: () => void;
}) {
  if (problem.kind === 'signIn') {
    // GitHub refused (signed out, or the sign-in was revoked): sign in, then the same action again
    return <GitHubLoginDialog onClose={onClose} onSignedIn={onSignedIn} />;
  }
  let title: string;
  let body: ReactNode;
  let actions: ReactNode = (
    <Button variant="filled" onClick={onClose}>
      OK
    </Button>
  );
  if (problem.kind === 'conflict') {
    title = 'Pull would conflict';
    body = (
      <>
        <p className="body">GitHub&apos;s changes and yours touch the same lines in:</p>
        <Files paths={problem.paths} />
        <p className="caption muted">
          Nothing was changed: your files and commits are as they were. Resolving conflicts in Pepino is coming (#143).
          For now, you can push your work to a new branch and merge it on GitHub.
        </p>
      </>
    );
  } else if (problem.kind === 'inTheWay') {
    title = 'Commit your changes first';
    body = (
      <>
        <p className="body">The pull would overwrite your uncommitted changes to:</p>
        <Files paths={problem.paths} />
        <p className="caption muted">Commit them, then pull again. Nothing was changed.</p>
      </>
    );
  } else {
    title = 'GitHub has new commits';
    body = (
      <p className="body">
        {upstream ?? 'This branch'} has commits you don&apos;t have yet, so the push would undo them. Pull first, then
        push.
      </p>
    );
    actions = (
      <>
        <Button variant="text" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="filled" onClick={onPull}>
          Pull
        </Button>
      </>
    );
  }
  return (
    <Dialog title={title} eyebrow={upstream ?? 'GITHUB'} onClose={onClose} actions={actions}>
      <div className={styles.problem}>{body}</div>
    </Dialog>
  );
}
