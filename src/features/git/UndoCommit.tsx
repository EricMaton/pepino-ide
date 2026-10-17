import { Button, Dialog } from '../../ui/components';
import { cx } from '../../ui/cx';
import { formatAgo } from '../projects/recents';
import { type LogEntry, shortId } from './engine';
import styles from './GitScreen.module.css';

/*
 * GitHub Desktop's Undo (#140) and Amend (#141) of the last commit. Undo
 * takes it away, its changes uncommitted again and its message back in the
 * commit box; Amend replaces it, with a new message or more changes. Only
 * while GitHub does not have it: then this explains why not.
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

/** Undo or Amend refused: the commit is on GitHub already. */
export function PushedDialog({ commit, amend, onClose }: { commit: LogEntry; amend: boolean; onClose: () => void }) {
  return (
    <Dialog
      title="Already on GitHub"
      eyebrow={`${amend ? 'AMEND' : 'UNDO'} · ${shortId(commit.id)}`}
      onClose={onClose}
      actions={
        <Button variant="filled" onClick={onClose}>
          OK
        </Button>
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
            : 'To take its changes back safely, a new commit has to undo them: a revert.'}
        </p>
      </div>
    </Dialog>
  );
}
