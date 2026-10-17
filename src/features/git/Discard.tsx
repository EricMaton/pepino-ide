import { useState } from 'react';
import { useServices } from '../../app/services';
import { Button, Dialog } from '../../ui/components';
import { cx } from '../../ui/cx';
import { errorMessage } from '../projects/errors';
import { basename } from '../projects/paths';
import type { LineExclusion } from './diff';
import type { FileChange } from './engine';
import styles from './GitScreen.module.css';

/*
 * GitHub Desktop's Discard changes (#138): a file, all of them, or some of
 * a file's lines, back to the last commit. Always confirmed first, and
 * snapshotted by the engine, so Earlier versions keeps what was discarded.
 */

/** What to discard: whole files, or the lines picked in one file's diff. */
export type Discarding =
  | { kind: 'files'; changes: readonly FileChange[]; all: boolean }
  | { kind: 'lines'; file: string; lines: LineExclusion };

/** Actions on a changed file (its ⋮ in Changes). */
export function ChangeActionsDialog({
  change,
  onClose,
  onDiscard,
}: {
  change: FileChange;
  onClose: () => void;
  onDiscard: () => void;
}) {
  return (
    <Dialog title={basename(change.path)} eyebrow={change.path} onClose={onClose}>
      <div className={styles.actionList}>
        <Button variant="text" tone="danger" listItem onClick={onDiscard}>
          <span className="accent" aria-hidden>
            ›
          </span>
          {change.kind === 'new' ? 'Discard: delete this new file…' : 'Discard changes…'}
        </Button>
      </div>
    </Dialog>
  );
}

/** "Discard changes?" for [what], in plain words; discards on confirm and calls [onDiscarded]. */
export function DiscardDialog({
  path,
  what,
  onClose,
  onDiscarded,
}: {
  /** The repository. */
  path: string;
  what: Discarding;
  onClose: () => void;
  onDiscarded: () => void;
}) {
  const { git } = useServices();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const discard = async () => {
    setBusy(true);
    setError(null);
    try {
      if (what.kind === 'files') await git.discard(path, { paths: what.changes.map((change) => change.path) });
      else await git.discard(path, { paths: [what.file], lines: { [what.file]: what.lines } });
      onDiscarded();
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  };

  let title: string;
  let body: string;
  if (what.kind === 'lines') {
    const count = what.lines.lines.length;
    title = `Discard ${count} ${count === 1 ? 'line' : 'lines'}?`;
    body = `The picked changes to ${basename(what.file)} go back to the last commit. Its other changes stay.`;
  } else if (what.all) {
    const count = what.changes.length;
    title = 'Discard all changes?';
    body = `${count === 1 ? 'The changed file goes' : `All ${count} changed files go`} back to the last commit; new files are deleted.`;
  } else {
    const [change] = what.changes;
    const name = basename(change.path);
    title = change.kind === 'new' ? `Delete ${name}?` : 'Discard changes?';
    body =
      change.kind === 'new'
        ? `${name} is new, not in any commit: discarding it deletes it.`
        : change.kind === 'deleted'
          ? `${name} comes back, as it is in the last commit.`
          : `${name} goes back to the last commit: every change to it since is undone.`;
  }

  return (
    <Dialog
      title={title}
      eyebrow={what.kind === 'lines' ? what.file : what.all ? 'CHANGES' : what.changes[0].path}
      onClose={onClose}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="filled"
            tone="danger"
            className={cx(busy && 'cursor')}
            disabled={busy}
            onClick={() => void discard()}
          >
            {busy ? 'Discarding' : 'Discard'}
          </Button>
        </>
      }
    >
      <div className={styles.identityFields}>
        <p className="body">{body}</p>
        <p className="caption muted">
          Pepino keeps a snapshot first: if you change your mind, the editor&apos;s Earlier versions has the files as
          they were.
        </p>
        {error && (
          <p className={cx('caption', styles.branchError)} role="alert">
            ✕ {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
