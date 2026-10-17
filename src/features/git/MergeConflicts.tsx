import { useEffect, useMemo, useState } from 'react';
import { useServices } from '../../app/services';
import { useBackHandler } from '../../ui/back';
import { Button, Dialog, TextField } from '../../ui/components';
import { cx } from '../../ui/cx';
import { BackIcon } from '../../ui/icons';
import { errorMessage } from '../projects/errors';
import { basename, joinPath, parentPath } from '../projects/paths';
import { type ConflictChoice, conflictCount, parseConflicts, resolveConflicts } from './conflicts';
import type { MergeInfo } from './engine';
import styles from './GitScreen.module.css';

/*
 * Resolving a merge in Pepino (#143), as GitHub Desktop does: Changes says a
 * merge is in progress, each conflicted file opens here with its clashes as
 * «yours / GitHub's» to choose from (or the file edited by hand), and the
 * commit finishes the merge, or Abort puts everything back.
 */

/** "MERGING origin/main · 2 conflicted files", with Abort, above the changed files. */
export function MergeBar({
  merge,
  conflicted,
  busy,
  onAbort,
}: {
  merge: MergeInfo;
  conflicted: number;
  busy: boolean;
  onAbort: () => void;
}) {
  return (
    <div className={styles.mergeBar} role="status">
      <span className={styles.changeText}>
        <span className="caption accent ellipsis">MERGING {merge.theirs}</span>
        <span className="caption muted">
          {conflicted > 0
            ? `${conflicted} conflicted ${conflicted === 1 ? 'file' : 'files'}: open ${conflicted === 1 ? 'it' : 'each'} to resolve, then commit`
            : 'Every conflict resolved: commit to finish the merge'}
        </span>
      </span>
      <Button variant="text" tone="danger" disabled={busy} onClick={onAbort}>
        Abort
      </Button>
    </div>
  );
}

export function AbortMergeDialog({
  merge,
  onClose,
  onAbort,
}: {
  merge: MergeInfo;
  onClose: () => void;
  onAbort: () => void;
}) {
  return (
    <Dialog
      title="Abort the merge?"
      eyebrow={`MERGING ${merge.theirs}`}
      onClose={onClose}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="filled" tone="danger" onClick={onAbort}>
            Abort merge
          </Button>
        </>
      }
    >
      <p className="body">
        The branch and its files go back to how they were before the merge. What you resolved so far is kept in the
        files&apos; Earlier versions.
      </p>
    </Dialog>
  );
}

/** A run of plain text between conflicts: its first and last lines, the rest folded. */
function Context({ text }: { text: string }) {
  const lines = text.replace(/\n$/, '').split('\n');
  const shown = lines.length > 4 ? [...lines.slice(0, 2), null, ...lines.slice(-2)] : lines;
  return (
    <pre className={styles.conflictContext}>
      {shown.map((line, i) =>
        line === null ? (
          <span key={i} className="muted">
            {`  ⋯ ${lines.length - 4} more lines\n`}
          </span>
        ) : (
          `${line}\n`
        ),
      )}
    </pre>
  );
}

const CHOICES: [ConflictChoice, string][] = [
  ['ours', 'Yours'],
  ['theirs', "GitHub's"],
  ['both', 'Both'],
];

/**
 * A conflicted [file] of the merge: each clash with your lines and GitHub's,
 * one side chosen for each (or both), then saved and marked resolved. Or the
 * whole file edited by hand. A file without markers (deleted on one side, or
 * not text) is kept or deleted as a whole.
 */
export function ConflictView({
  path,
  file,
  merge,
  onClose,
  onResolved,
}: {
  /** The repository. */
  path: string;
  file: string;
  merge: MergeInfo;
  onClose: () => void;
  onResolved: () => void;
}) {
  const { git, projectSpace } = useServices();
  const target = joinPath(path, file);
  // undefined while reading; null when the file is not there (deleted on one side)
  const [text, setText] = useState<string | null | undefined>(undefined);
  const [choices, setChoices] = useState<(ConflictChoice | undefined)[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useBackHandler(true, onClose);

  useEffect(() => {
    let active = true;
    projectSpace.readTextFile(target).then(
      (found) => active && setText(found),
      () => active && setText(null),
    );
    return () => {
      active = false;
    };
  }, [projectSpace, target]);

  const segments = useMemo(() => (text ? parseConflicts(text) : []), [text]);
  const count = conflictCount(segments);
  const resolved = resolveConflicts(segments, choices);

  const finish = async (write: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await write();
      await git.markResolved(path, file);
      onResolved();
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  };

  const choose = (index: number, choice: ConflictChoice) =>
    setChoices((current) => {
      const next = [...current];
      next[index] = choice;
      return next;
    });

  const folder = parentPath(file);
  let conflictIndex = 0;

  return (
    <div className={styles.diff}>
      <div className={styles.diffHead}>
        <Button variant="text" square aria-label="Back to the changes" onClick={onClose}>
          <BackIcon />
        </Button>
        <span className={styles.changeText}>
          <span className="body ellipsis">{basename(file)}</span>
          <span className="caption muted ellipsis">
            {text === undefined
              ? 'Reading'
              : count > 0
                ? `${count} ${count === 1 ? 'conflict' : 'conflicts'} with ${merge.theirs}`
                : 'Conflicted'}
            {folder && ` · ${folder}`}
          </span>
        </span>
      </div>

      <div className={styles.diffScroll}>
        {text === undefined ? (
          <p className={cx('label', 'cursor', styles.note)} data-loading>
            Reading the file
          </p>
        ) : editing !== null ? (
          <div className={styles.conflictEdit}>
            <TextField label="The whole file" value={editing} onChange={setEditing} rows={16} />
            <p className="caption muted">
              Leave no conflict markers (&lt;&lt;&lt;&lt;&lt;&lt;&lt;, =======, &gt;&gt;&gt;&gt;&gt;&gt;&gt;) in it.
            </p>
          </div>
        ) : count === 0 ? (
          <div className={styles.conflictEdit}>
            <p className="body">
              {text === null
                ? `One side deleted ${basename(file)} and the other changed it.`
                : `${basename(file)} has no conflict markers: one side deleted it and the other changed it, or it is not text.`}
            </p>
            <p className="caption muted">
              {text === null ? 'Leave it deleted, or ' : 'Keep it as it is now, or delete it. '}
              edit it in the workspace and come back.
            </p>
          </div>
        ) : (
          <>
            <div className={styles.conflictAll}>
              <Button variant="text" onClick={() => setChoices(Array(count).fill('ours'))}>
                All yours
              </Button>
              <Button variant="text" onClick={() => setChoices(Array(count).fill('theirs'))}>
                All GitHub&apos;s
              </Button>
              <Button variant="text" onClick={() => setEditing(resolved ?? text ?? '')}>
                Edit by hand
              </Button>
            </div>
            {segments.map((segment, i) => {
              if (segment.kind === 'text') return <Context key={i} text={segment.text} />;
              const index = conflictIndex++;
              const chosen = choices[index];
              return (
                <section key={i} className={styles.conflict} aria-label={`Conflict ${index + 1} of ${count}`}>
                  <div className={cx(styles.conflictSide, chosen && chosen !== 'theirs' && styles.conflictChosen)}>
                    <span className="caption muted">YOURS · {segment.oursLabel || 'HEAD'}</span>
                    <pre className={styles.conflictLines}>{segment.ours || '(nothing)'}</pre>
                  </div>
                  <div className={cx(styles.conflictSide, chosen && chosen !== 'ours' && styles.conflictChosen)}>
                    <span className="caption muted">GITHUB&apos;S · {segment.theirsLabel || merge.theirs}</span>
                    <pre className={styles.conflictLines}>{segment.theirs || '(nothing)'}</pre>
                  </div>
                  <div className={styles.conflictChoices} role="group" aria-label="Keep">
                    {CHOICES.map(([choice, label]) => (
                      <Button
                        key={choice}
                        variant={chosen === choice ? 'filled' : 'outlined'}
                        aria-pressed={chosen === choice}
                        onClick={() => choose(index, choice)}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                </section>
              );
            })}
          </>
        )}
        {error && (
          <p className={cx('caption', styles.note, styles.diffError)} role="alert">
            ✕ {error}
          </p>
        )}
      </div>

      <div className={styles.conflictFoot}>
        {editing !== null ? (
          <>
            <Button variant="text" disabled={busy} onClick={() => setEditing(null)}>
              Back
            </Button>
            <Button
              variant="filled"
              className={cx(busy && 'cursor')}
              disabled={busy}
              onClick={() => void finish(() => projectSpace.writeTextFile(target, editing))}
            >
              Save and mark resolved
            </Button>
          </>
        ) : count === 0 && text !== undefined ? (
          <>
            {text !== null && (
              <Button
                variant="text"
                tone="danger"
                disabled={busy}
                onClick={() => void finish(() => projectSpace.delete(target))}
              >
                Delete it
              </Button>
            )}
            <Button variant="filled" disabled={busy} onClick={() => void finish(async () => undefined)}>
              {text === null ? 'Leave it deleted' : 'Keep it'}
            </Button>
          </>
        ) : (
          <Button
            variant="filled"
            className={cx(busy && 'cursor')}
            disabled={busy || resolved === null}
            onClick={() => resolved !== null && void finish(() => projectSpace.writeTextFile(target, resolved))}
          >
            {resolved === null ? `Choose for ${count - choices.filter(Boolean).length} more` : 'Save and mark resolved'}
          </Button>
        )}
      </div>
    </div>
  );
}
