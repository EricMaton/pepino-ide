import { Button, Dialog } from '../../ui/components';
import { cx } from '../../ui/cx';
import { formatAgo } from '../projects/recents';
import { type LogEntry, shortId } from './engine';
import styles from './GitScreen.module.css';

/*
 * GitHub Desktop's Undo (#140): the last commit goes and its changes are
 * uncommitted again, its message back in the commit box. Only while GitHub
 * does not have it: then this explains why not.
 */

/** "Last commit · Fix the parser · 2M AGO", with Undo, under the changed files. */
export function LastCommitRow({
  commit,
  now,
  busy,
  onUndo,
}: {
  commit: LogEntry;
  now: number;
  busy: boolean;
  onUndo: () => void;
}) {
  return (
    <div className={styles.lastCommit}>
      <span className={styles.changeText}>
        <span className="caption muted ellipsis">
          LAST COMMIT · {shortId(commit.id)} · {formatAgo(commit.time, now)}
        </span>
        <span className="body ellipsis">{commit.summary}</span>
      </span>
      <Button variant="text" className={cx(busy && 'cursor')} disabled={busy} onClick={onUndo}>
        {busy ? 'Undoing' : 'Undo'}
      </Button>
    </div>
  );
}

/** Undo refused: the commit is on GitHub already. */
export function PushedDialog({ commit, onClose }: { commit: LogEntry; onClose: () => void }) {
  return (
    <Dialog
      title="Already on GitHub"
      eyebrow={`UNDO · ${shortId(commit.id)}`}
      onClose={onClose}
      actions={
        <Button variant="filled" onClick={onClose}>
          OK
        </Button>
      }
    >
      <div className={styles.identityFields}>
        <p className="body">
          “{commit.summary}” has been pushed. Undoing it here would leave your branch behind GitHub’s, and only a force
          push, which rewrites GitHub’s history, would bring them back together.
        </p>
        <p className="caption muted">To take its changes back safely, a new commit has to undo them: a revert.</p>
      </div>
    </Dialog>
  );
}
