import { useState } from 'react';
import { useServices } from '../../app/services';
import { Button, Dialog } from '../../ui/components';
import { cx } from '../../ui/cx';
import { errorMessage } from '../projects/errors';
import { basename, parentPath } from '../projects/paths';
import { formatAgo } from '../projects/recents';
import { KIND_MARKS } from './changeKinds';
import type { StashInfo } from './engine';
import styles from './GitScreen.module.css';

/*
 * GitHub Desktop's stash (#139): one per branch. Changes shows it as a row;
 * its dialog lists the files and restores them (onto a branch without
 * changes) or throws them away, after asking.
 */

/** "Stashed changes · 3 files · 2H AGO", above the changed files. */
export function StashRow({ stash, now, onOpen }: { stash: StashInfo; now: number; onOpen: () => void }) {
  const count = stash.files.length;
  return (
    <button type="button" className={styles.stashRow} onClick={onOpen}>
      <span className={cx('label', 'accent')} aria-hidden>
        ⧉
      </span>
      <span className={styles.changeText}>
        <span className="body">Stashed changes</span>
        <span className="caption muted ellipsis">
          {count} {count === 1 ? 'file' : 'files'} · {formatAgo(stash.time, now)} · restore or discard
        </span>
      </span>
      <span className={cx('label', 'accent')} aria-hidden>
        ▸
      </span>
    </button>
  );
}

export function StashDialog({
  path,
  stash,
  hasChanges,
  now,
  onClose,
  onDone,
}: {
  /** The repository. */
  path: string;
  stash: StashInfo;
  /** Uncommitted changes: the stash cannot go back until they are committed or discarded. */
  hasChanges: boolean;
  now: number;
  onClose: () => void;
  /** Restored or discarded: [message] to confirm it. */
  onDone: (message: string) => void;
}) {
  const { git } = useServices();
  const [busy, setBusy] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = stash.files.length;
  const files = `${count} ${count === 1 ? 'file' : 'files'}`;

  const run = async (action: () => Promise<void>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onDone(done);
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
      setConfirmingDiscard(false);
    }
  };

  if (confirmingDiscard) {
    return (
      <Dialog
        title="Discard the stash?"
        eyebrow={`STASH · ${stash.branch}`}
        onClose={() => setConfirmingDiscard(false)}
        actions={
          <>
            <Button variant="text" onClick={() => setConfirmingDiscard(false)}>
              Cancel
            </Button>
            <Button
              variant="filled"
              tone="danger"
              disabled={busy}
              onClick={() => void run(() => git.dropStash(path), 'Stashed changes discarded')}
            >
              Discard
            </Button>
          </>
        }
      >
        <p className="body">
          The changes stashed on {stash.branch} ({files}) are thrown away. This cannot be undone.
        </p>
      </Dialog>
    );
  }

  return (
    <Dialog
      title="Stashed changes"
      eyebrow={`${stash.branch} · ${formatAgo(stash.time, now)}`}
      onClose={onClose}
      actions={
        <>
          <Button variant="text" tone="danger" disabled={busy} onClick={() => setConfirmingDiscard(true)}>
            Discard
          </Button>
          <Button
            variant="filled"
            className={cx(busy && 'cursor')}
            disabled={busy || hasChanges}
            onClick={() => void run(() => git.restoreStash(path), `Restored ${files}`)}
          >
            {busy ? 'Restoring' : 'Restore'}
          </Button>
        </>
      }
    >
      <div className={styles.identityFields}>
        <p className="caption muted">
          Set aside on {stash.branch}, not committed. Restore puts them back in Changes; the stash is then gone.
        </p>
        <ul className={styles.stashFiles}>
          {stash.files.map((change) => {
            const { mark, label } = KIND_MARKS[change.kind];
            const folder = parentPath(change.path);
            return (
              <li key={change.path} className={styles.stashFile}>
                <span className={styles.changeText}>
                  <span className="body ellipsis">{basename(change.path)}</span>
                  {folder && <span className="caption muted ellipsis">{folder}</span>}
                </span>
                <span className={cx('label', styles.kind, styles[`kind-${change.kind}`])} title={label}>
                  <span aria-hidden>{mark}</span>
                  <span className="visually-hidden">{label}</span>
                </span>
              </li>
            );
          })}
        </ul>
        {hasChanges && (
          <p className={cx('caption', styles.branchError)}>
            Commit or discard your changes first: the stash goes back onto a branch without changes.
          </p>
        )}
        {error && (
          <p className={cx('caption', styles.branchError)} role="alert">
            ✕ {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
