import { useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import { Button, Dialog } from '../../ui/components';
import { cx } from '../../ui/cx';
import { errorMessage } from '../projects/errors';
import { formatAgo } from '../projects/recents';
import { type LogEntry, shortId, type SyncCommits, type SyncState } from './engine';
import { type Action, commits, formatStamp } from './sync';
import styles from './SyncBar.module.css';

/*
 * The sync status screen (#35): where the branch stands against GitHub's,
 * as of the last fetch, and when that was. The commits behind each count,
 * GitHub's to pull and the branch's to push, are listed by name, so the
 * numbers on the bar say what they are. The bar's action is at hand.
 */

const ACTION_LABELS: Record<Action, string> = { publish: 'Publish', pull: 'Pull', push: 'Push', fetch: 'Fetch' };

export function SyncStatusDialog({
  path,
  branch,
  state,
  action,
  now,
  onRun,
  onClose,
}: {
  path: string;
  branch: string;
  state: SyncState;
  /** What the bar offers: the dialog's main button does it. */
  action: Action;
  /** "5M AGO" counts from it. */
  now: number;
  onRun: () => void;
  onClose: () => void;
}) {
  const { git } = useServices();
  const [found, setFound] = useState<SyncCommits | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read again after each fetch, pull or push (the state changes)
  useEffect(() => {
    let active = true;
    git.syncCommits(path).then(
      (result) => active && setFound(result),
      (failure: unknown) => active && setError(errorMessage(failure)),
    );
    return () => {
      active = false;
    };
  }, [git, path, state]);

  return (
    <Dialog
      title="Sync status"
      eyebrow={state.upstream ? `${branch} ⇄ ${state.upstream}` : branch}
      onClose={onClose}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Close
          </Button>
          <Button variant="filled" onClick={onRun}>
            {ACTION_LABELS[action]}
          </Button>
        </>
      }
    >
      <div className={styles.status}>
        <div className={styles.fetched}>
          <span className="caption muted">LAST FETCHED</span>
          {state.lastFetched === null ? (
            <span className="body">Never: fetch to see what GitHub has</span>
          ) : (
            <span className="body">
              {formatAgo(state.lastFetched, now)}{' '}
              <span className="caption muted">· {formatStamp(state.lastFetched)}</span>
            </span>
          )}
        </div>

        {!state.upstream ? (
          <p className="body">{branch} is not on GitHub yet. Publish it to compare it with GitHub&apos;s.</p>
        ) : state.ahead === 0 && state.behind === 0 ? (
          <p className="body">
            Up to date with {state.upstream}, as of the last fetch. A fetch checks whether GitHub has new commits.
          </p>
        ) : error ? (
          <p className={cx('caption', styles.error)} role="alert">
            ✕ {error}
          </p>
        ) : (
          <>
            {state.behind > 0 && (
              <Commits
                heading={`To pull · ${commits(state.behind)} on GitHub`}
                list={found?.toPull ?? null}
                total={state.behind}
                now={now}
              />
            )}
            {state.ahead > 0 && (
              <Commits
                heading={`To push · ${commits(state.ahead)} only here`}
                list={found?.toPush ?? null}
                total={state.ahead}
                now={now}
              />
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

function Commits({
  heading,
  list,
  total,
  now,
}: {
  heading: string;
  /** Null while it is read. */
  list: LogEntry[] | null;
  total: number;
  now: number;
}) {
  return (
    <section>
      <h3 className={cx('label', 'muted', styles.statusHeading)}>
        <span className="accent">//</span> {heading}
      </h3>
      {list === null ? (
        <p className="label cursor" data-loading>
          Reading commits
        </p>
      ) : (
        <ul className={styles.commits}>
          {list.map((commit) => (
            <li key={commit.id} className={styles.commit}>
              <span className={styles.text}>
                <span className="body ellipsis">{commit.summary}</span>
                <span className="caption muted ellipsis">
                  {commit.author} · {formatAgo(commit.time, now)}
                </span>
              </span>
              <span className={cx('caption', styles.commitId)}>{shortId(commit.id)}</span>
            </li>
          ))}
          {total > list.length && <li className="caption muted">and {total - list.length} more</li>}
        </ul>
      )}
    </section>
  );
}
