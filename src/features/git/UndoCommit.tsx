import { Button, Dialog } from '../../ui/components';
import { cx } from '../../ui/cx';
import { formatAgo } from '../projects/recents';
import { type LogEntry, shortId } from './engine';
import styles from './GitScreen.module.css';

/*
 * GitHub Desktop's Undo (#140) and Amend (#141) of the last commit, and
 * Revert (#142) of any. Undo takes it away, its changes uncommitted again and
 * its message back in the commit box; Amend replaces it, with a new message
 * or more changes. Only while GitHub does not have it: then this explains why
 * not, and offers Revert, a new commit that undoes it.
 */

/** A commit back in the commit box: undone, to commit again, or to amend. */
export interface Reopened {
  commit: LogEntry;
  amend: boolean;
}

/** "Last commit · Fix the parser · 2M AGO", with Amend and Undo, under the changed files. */
export function LastCommitRow({
  commit,
  now,
  busy,
  onUndo,
  onAmend,
}: {
  commit: LogEntry;
  now: number;
  busy: boolean;
  onUndo: () => void;
  onAmend: () => void;
}) {
  return (
    <div className={styles.lastCommit}>
      <span className={styles.changeText}>
        <span className="caption muted ellipsis">
          LAST COMMIT · {shortId(commit.id)} · {formatAgo(commit.time, now)}
        </span>
        <span className="body ellipsis">{commit.summary}</span>
      </span>
      <Button variant="text" disabled={busy} onClick={onAmend}>
        Amend
      </Button>
      <Button variant="text" className={cx(busy && 'cursor')} disabled={busy} onClick={onUndo}>
        {busy ? 'Undoing' : 'Undo'}
      </Button>
    </div>
  );
}

/** Undo or Amend refused: the commit is on GitHub already. [onRevert] offers the safe way, for an undo. */
export function PushedDialog({
  commit,
  amend,
  onClose,
  onRevert,
}: {
  commit: LogEntry;
  amend: boolean;
  onClose: () => void;
  onRevert?: () => void;
}) {
  return (
    <Dialog
      title="Already on GitHub"
      eyebrow={`${amend ? 'AMEND' : 'UNDO'} · ${shortId(commit.id)}`}
      onClose={onClose}
      actions={
        !amend && onRevert ? (
          <>
            <Button variant="text" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="filled" onClick={onRevert}>
              Revert
            </Button>
          </>
        ) : (
          <Button variant="filled" onClick={onClose}>
            OK
          </Button>
        )
      }
    >
      <div className={styles.identityFields}>
        <p className="body">
          “{commit.summary}” has been pushed.{' '}
          {amend
            ? 'Amending it here would replace a commit GitHub has, and only a force push, which rewrites GitHub’s history, would get GitHub to take the new one.'
            : 'Undoing it here would leave your branch behind GitHub’s, and only a force push, which rewrites GitHub’s history, would bring them back together.'}
        </p>
        <p className="caption muted">
          {amend
            ? 'Make the fix a new commit instead.'
            : 'Revert it instead: a new commit that undoes its changes, safe on GitHub too.'}
        </p>
      </div>
    </Dialog>
  );
}

/** Why a revert (#142) changed nothing: later commits changed the same lines ([clash]), or uncommitted changes are in the way. */
export interface RevertProblem {
  clash: boolean;
  paths: readonly string[];
}

export function RevertProblemDialog({
  commit,
  problem,
  onClose,
}: {
  commit: LogEntry;
  problem: RevertProblem;
  onClose: () => void;
}) {
  return (
    <Dialog
      title={problem.clash ? 'It clashes with later commits' : 'Your changes are in the way'}
      eyebrow={`REVERT · ${shortId(commit.id)}`}
      onClose={onClose}
      actions={
        <Button variant="filled" onClick={onClose}>
          OK
        </Button>
      }
    >
      <div className={styles.identityFields}>
        <p className="body">
          {problem.clash
            ? `Commits made after “${commit.summary}” changed the same lines. Nothing was changed.`
            : `Reverting “${commit.summary}” rewrites files you have changed and not committed. Nothing was changed: commit or discard those changes first.`}
        </p>
        <ul className={styles.stashFiles}>
          {problem.paths.map((path) => (
            <li key={path} className={cx('body', 'ellipsis', styles.stashFile)}>
              {path}
            </li>
          ))}
        </ul>
        {problem.clash && (
          <p className="caption muted">Undo those lines by hand and commit, or revert the later commits first.</p>
        )}
      </div>
    </Dialog>
  );
}
