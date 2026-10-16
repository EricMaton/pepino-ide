import { useCallback, useEffect, useRef, useState } from 'react';
import { useServices } from '../../app/services';
import { Button, Dialog, TextField } from '../../ui/components';
import { cx } from '../../ui/cx';
import { useSnackbar } from '../../ui/useSnackbar';
import { errorMessage } from '../projects/errors';
import { basename, isWithin, parentPath } from '../projects/paths';
import type { ChangeKind, CommitResult, FileChange, Identity } from './engine';
import styles from './GitScreen.module.css';

/** Files written in a burst (autosave, a plugin) re-read the status once. */
const STATUS_DEBOUNCE_MS = 400;

const KIND_MARKS: Record<ChangeKind, { mark: string; label: string }> = {
  new: { mark: '+', label: 'New' },
  modified: { mark: '•', label: 'Modified' },
  deleted: { mark: '−', label: 'Deleted' },
  conflicted: { mark: '!', label: 'Conflicted' },
};

/** The repository's changes, re-read whenever files inside it change. Null while the first read runs. */
function useChanges(path: string): { changes: FileChange[] | null; refresh: () => void } {
  const { git, events } = useServices();
  const showSnackbar = useSnackbar();
  const [tick, setTick] = useState(0);
  const [changes, setChanges] = useState<FileChange[] | null>(null);
  const refresh = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const touched = (file: string) => {
      if (!isWithin(file, path)) return;
      clearTimeout(timer);
      timer = setTimeout(refresh, STATUS_DEBOUNCE_MS);
    };
    const disposers = [
      events.subscribe('fs.created', ({ path: file }) => touched(file)),
      events.subscribe('fs.written', ({ path: file }) => touched(file)),
      events.subscribe('fs.deleted', ({ path: file }) => touched(file)),
      events.subscribe('fs.moved', ({ from, to }) => {
        touched(from);
        touched(to);
      }),
    ];
    return () => {
      clearTimeout(timer);
      disposers.forEach((dispose) => dispose());
    };
  }, [events, path, refresh]);

  useEffect(() => {
    let active = true;
    git.status(path).then(
      (found) => active && setChanges(found),
      (error: unknown) => {
        if (!active) return;
        setChanges((current) => current ?? []);
        showSnackbar(`Error: ${errorMessage(error)}`);
      },
    );
    return () => {
      active = false;
    };
  }, [git, path, tick, showSnackbar]);

  return { changes, refresh };
}

/**
 * GitHub Desktop's Changes: every changed file with a tick (all ticked by
 * default), and the commit box under them. The commit takes exactly the
 * ticked files; partial (line) staging comes with the diff viewer (#25).
 */
export function ChangesView({
  path,
  branch,
  onCommitted,
}: {
  /** The repository (the active project). */
  path: string;
  branch: string;
  onCommitted: () => void;
}) {
  const { git } = useServices();
  const showSnackbar = useSnackbar();
  const { changes, refresh } = useChanges(path);
  // Unticked files; anything new comes in ticked
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [committing, setCommitting] = useState(false);
  // The last commit, confirmed where it was made (a snackbar would cover the commit box)
  const [lastCommit, setLastCommit] = useState<CommitResult | null>(null);
  const [identity, setIdentity] = useState<Identity | null | undefined>(undefined);
  const [askingIdentity, setAskingIdentity] = useState(false);
  const pendingCommit = useRef(false);

  useEffect(() => {
    let active = true;
    git.identity().then(
      (found) => active && setIdentity(found),
      () => active && setIdentity(null),
    );
    return () => {
      active = false;
    };
  }, [git]);

  const ticked = (changes ?? []).filter((change) => !excluded.has(change.path));
  const allTicked = changes !== null && changes.length > 0 && ticked.length === changes.length;
  const canCommit = ticked.length > 0 && summary.trim() !== '' && !committing;

  const toggle = (file: string) =>
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  const toggleAll = () => setExcluded(allTicked ? new Set((changes ?? []).map((change) => change.path)) : new Set());

  const commit = async () => {
    if (!canCommit) return;
    if (!identity) {
      pendingCommit.current = true;
      setAskingIdentity(true);
      return;
    }
    setCommitting(true);
    setLastCommit(null);
    const message = description.trim() ? `${summary.trim()}\n\n${description.trim()}` : summary.trim();
    try {
      const result = await git.commit(path, { message, paths: ticked.map((change) => change.path) });
      setLastCommit(result);
      setSummary('');
      setDescription('');
      setExcluded(new Set());
      refresh();
      onCommitted();
    } catch (error) {
      showSnackbar(`Error: ${errorMessage(error)}`);
    } finally {
      setCommitting(false);
    }
  };

  // The commit that asked for an identity goes on once it is set.
  useEffect(() => {
    if (identity && pendingCommit.current) {
      pendingCommit.current = false;
      void commit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once the identity arrives
  }, [identity]);

  const count = changes?.length ?? 0;

  return (
    <div className={styles.changes}>
      <div className={styles.changesHead}>
        <label className={styles.checkRow}>
          <input
            type="checkbox"
            className={styles.check}
            checked={allTicked}
            ref={(input) => {
              if (input) input.indeterminate = ticked.length > 0 && !allTicked;
            }}
            disabled={count === 0}
            onChange={toggleAll}
          />
          <span className="label">
            {changes === null ? 'Changes' : `${count} changed ${count === 1 ? 'file' : 'files'}`}
          </span>
        </label>
      </div>

      <div className={styles.changeList}>
        {changes === null ? (
          <p className={cx('label', 'cursor', styles.note)} data-loading>
            Reading changes
          </p>
        ) : changes.length === 0 ? (
          <div className={styles.noChanges}>
            <p className="title">No local changes</p>
            <p className="caption muted">Edit files in the workspace and they show up here, ready to commit.</p>
          </div>
        ) : (
          changes.map((change) => {
            const folder = parentPath(change.path);
            const { mark, label } = KIND_MARKS[change.kind];
            return (
              <label key={change.path} className={styles.change}>
                <input
                  type="checkbox"
                  className={styles.check}
                  checked={!excluded.has(change.path)}
                  onChange={() => toggle(change.path)}
                />
                <span className={styles.changeText}>
                  <span className="body ellipsis">{basename(change.path)}</span>
                  {folder && <span className="caption muted ellipsis">{folder}</span>}
                </span>
                <span className={cx('label', styles.kind, styles[`kind-${change.kind}`])} title={label}>
                  <span aria-hidden>{mark}</span>
                  <span className="visually-hidden">{label}</span>
                </span>
              </label>
            );
          })
        )}
      </div>

      <form
        className={styles.commitBox}
        onSubmit={(event) => {
          event.preventDefault();
          void commit();
        }}
      >
        <TextField label="Summary" placeholder="What changed" value={summary} onChange={setSummary} />
        <TextField
          label="Description"
          placeholder="Why (optional)"
          value={description}
          onChange={setDescription}
          rows={2}
        />
        <Button type="submit" variant="filled" className={cx(committing && 'cursor')} disabled={!canCommit}>
          {committing
            ? 'Committing'
            : ticked.length > 0
              ? `Commit ${ticked.length} ${ticked.length === 1 ? 'file' : 'files'} to ${branch}`
              : `Commit to ${branch}`}
        </Button>
        {lastCommit && (
          <p className={cx('caption', styles.committed)} role="status">
            <span className="accent">✓</span> Committed <strong>{lastCommit.id}</strong> · {lastCommit.summary}
          </p>
        )}
        <button type="button" className={cx('caption', 'muted', styles.author)} onClick={() => setAskingIdentity(true)}>
          {identity ? `As ${identity.name} <${identity.email}> · change` : 'Set who commits'}
        </button>
      </form>

      {askingIdentity && (
        <IdentityDialog
          current={identity ?? null}
          onClose={() => {
            pendingCommit.current = false;
            setAskingIdentity(false);
          }}
          onSaved={(saved) => {
            setAskingIdentity(false);
            setIdentity(saved);
          }}
        />
      )}
    </div>
  );
}

const looksLikeEmail = (email: string) => /^[^\s@]+@[^\s@]+$/.test(email.trim());

/** Git signs every commit with a name and an email; the app keeps them in its own git config. */
function IdentityDialog({
  current,
  onClose,
  onSaved,
}: {
  current: Identity | null;
  onClose: () => void;
  onSaved: (identity: Identity) => void;
}) {
  const { git } = useServices();
  const showSnackbar = useSnackbar();
  const [name, setName] = useState(current?.name ?? '');
  const [email, setEmail] = useState(current?.email ?? '');
  const emailError = email.trim() && !looksLikeEmail(email) ? 'Not an email' : null;
  const valid = name.trim() !== '' && looksLikeEmail(email);

  const save = () => {
    if (!valid) return;
    const identity = { name: name.trim(), email: email.trim() };
    git.setIdentity(identity).then(
      () => onSaved(identity),
      (error: unknown) => showSnackbar(`Error: ${errorMessage(error)}`),
    );
  };

  return (
    <Dialog
      title="Who commits"
      eyebrow="GIT · AUTHOR"
      onClose={onClose}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="filled" disabled={!valid} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className={styles.identityFields}>
        <p className="caption muted">Every commit records a name and an email. They stay on this device.</p>
        <TextField label="Name" placeholder="Ana García" value={name} onChange={setName} autoFocus />
        <TextField
          label="Email"
          placeholder="ana@example.com"
          value={email}
          onChange={setEmail}
          error={emailError}
          inputMode="email"
          onSubmit={save}
        />
      </div>
    </Dialog>
  );
}
