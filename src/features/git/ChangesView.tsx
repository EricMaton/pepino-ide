import { useCallback, useEffect, useRef, useState } from 'react';
import { useServices } from '../../app/services';
import { Button, Dialog, TextField } from '../../ui/components';
import { cx } from '../../ui/cx';
import { MoreIcon } from '../../ui/icons';
import { navigate } from '../../ui/motion';
import { useSnackbar } from '../../ui/useSnackbar';
import { errorMessage } from '../projects/errors';
import { basename, isWithin, parentPath } from '../projects/paths';
import type { LineExclusion } from './diff';
import { DiffView } from './DiffView';
import { ChangeActionsDialog, type Discarding, DiscardDialog } from './Discard';
import { StashDialog, StashRow } from './Stash';
import { KIND_MARKS } from './changeKinds';
import { type CommitResult, type FileChange, GitError, type Identity, type StashInfo } from './engine';
import styles from './GitScreen.module.css';
import type { Selection } from './selection';

/** Files written in a burst (autosave, a plugin) re-read the status once. */
const STATUS_DEBOUNCE_MS = 400;

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
 * default), and the commit box under them. Tapping a file opens its diff,
 * where single lines can be left out. The commit takes exactly the ticked
 * files, without the lines left out.
 */
export function ChangesView({
  path,
  branch,
  visible,
  onCommitted,
}: {
  /** The repository (the active project). */
  path: string;
  branch: string;
  /** False while History shows: an open diff waits, and leaves back alone, until Changes shows again. */
  visible: boolean;
  onCommitted: () => void;
}) {
  const { git } = useServices();
  const showSnackbar = useSnackbar();
  const { changes, refresh } = useChanges(path);
  // Unticked files; anything new comes in ticked
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  // Ticked files with some of their lines left out (picked in the diff)
  const [partial, setPartial] = useState<Readonly<Record<string, LineExclusion>>>({});
  // The file whose diff is open
  const [opened, setOpened] = useState<string | null>(null);
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [committing, setCommitting] = useState(false);
  // The message fields, folded to one row by default: the changed files get the room
  const [composing, setComposing] = useState(false);
  // The last commit, confirmed where it was made (a snackbar would cover the commit box)
  const [lastCommit, setLastCommit] = useState<CommitResult | null>(null);
  const [identity, setIdentity] = useState<Identity | null | undefined>(undefined);
  const [askingIdentity, setAskingIdentity] = useState(false);
  const pendingCommit = useRef(false);
  // Discarding (#138): the file whose ⋮ is open, the header's ⋮, and what is being confirmed
  const [acting, setActing] = useState<FileChange | null>(null);
  const [changesMenu, setChangesMenu] = useState(false);
  const [discarding, setDiscarding] = useState<Discarding | null>(null);
  // The branch's stash (#139), read again after stashing or restoring; [at] dates "2H AGO"
  const [stash, setStash] = useState<{ info: StashInfo | null; at: number } | null>(null);
  const [stashTick, setStashTick] = useState(0);
  const [showingStash, setShowingStash] = useState(false);
  const [replacingStash, setReplacingStash] = useState(false);

  useEffect(() => {
    let active = true;
    git.stash(path).then(
      (info) => active && setStash({ info, at: Date.now() }),
      () => active && setStash({ info: null, at: Date.now() }),
    );
    return () => {
      active = false;
    };
  }, [git, path, stashTick]);

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

  const selectionOf = (file: string): Selection => (excluded.has(file) ? 'none' : (partial[file] ?? 'all'));
  const select = useCallback((file: string, selection: Selection) => {
    setExcluded((current) => {
      if (current.has(file) === (selection === 'none')) return current;
      const next = new Set(current);
      if (selection === 'none') next.add(file);
      else next.delete(file);
      return next;
    });
    setPartial((current) => {
      if (typeof selection === 'object') return { ...current, [file]: selection };
      if (!(file in current)) return current;
      const next = { ...current };
      delete next[file];
      return next;
    });
  }, []);
  const toggle = (file: string) => select(file, excluded.has(file) ? 'all' : 'none');
  // Ticked with lines left out reads as "some", like a file not ticked at all
  const anyPartial = ticked.some((change) => change.path in partial);
  const toggleAll = () => {
    setPartial({});
    setExcluded(allTicked && !anyPartial ? new Set((changes ?? []).map((change) => change.path)) : new Set());
  };
  const onSelectOpened = useCallback(
    (selection: Selection) => opened !== null && select(opened, selection),
    [opened, select],
  );
  const open = (file: string) => navigate('forward', () => setOpened(file));
  const close = useCallback(() => navigate('back', () => setOpened(null)), []);

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
    const paths = ticked.map((change) => change.path);
    const lines = Object.fromEntries(paths.filter((file) => file in partial).map((file) => [file, partial[file]]));
    try {
      const result = await git.commit(path, { message, paths, excluded: lines });
      setLastCommit(result);
      setComposing(false);
      setSummary('');
      setDescription('');
      setExcluded(new Set());
      setPartial({});
      refresh();
      onCommitted();
    } catch (error) {
      // Lines picked before the file changed again: they are all in again, to be checked
      if (error instanceof GitError && error.code === 'STALE') error.paths.forEach((file) => select(file, 'all'));
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

  const stashChanges = async () => {
    setReplacingStash(false);
    try {
      const info = await git.stashChanges(path);
      setExcluded(new Set());
      setPartial({});
      if (opened !== null) close();
      refresh();
      setStashTick((value) => value + 1);
      const stashed = info.files.length;
      showSnackbar(`Stashed ${stashed} ${stashed === 1 ? 'file' : 'files'} on ${branch}`);
    } catch (error) {
      showSnackbar(`Error: ${errorMessage(error)}`);
    }
  };

  const discarded = () => {
    const what = discarding;
    setDiscarding(null);
    if (!what) return;
    // Lines picked on the old contents no longer mean anything: the files are whole in the commit again
    const files = what.kind === 'lines' ? [what.file] : what.changes.map((change) => change.path);
    files.forEach((file) => select(file, 'all'));
    if (what.kind === 'files' && opened !== null && files.includes(opened)) close();
    refresh();
    showSnackbar(
      what.kind === 'lines'
        ? `Discarded ${what.lines.lines.length} ${what.lines.lines.length === 1 ? 'line' : 'lines'} of ${basename(what.file)}`
        : files.length === 1
          ? `Discarded changes to ${basename(files[0])}`
          : `Discarded changes to ${files.length} files`,
    );
  };
  const commitLabel =
    ticked.length > 0
      ? `Commit ${ticked.length} ${ticked.length === 1 ? 'file' : 'files'} to ${branch}`
      : `Commit to ${branch}`;
  // What the folded row says: the message so far, else the last commit, else what a commit would take
  const folded = summary.trim()
    ? summary.trim()
    : lastCommit
      ? `✓ Committed ${lastCommit.id} · ${lastCommit.summary}`
      : count === 0
        ? 'Nothing to commit'
        : commitLabel;

  return (
    <div className={styles.changes}>
      <div className={styles.changesHead} inert={opened !== null}>
        <label className={cx(styles.checkRow, styles.checkRowGrow)}>
          <input
            type="checkbox"
            className={styles.check}
            checked={allTicked}
            ref={(input) => {
              if (input) input.indeterminate = ticked.length > 0 && (!allTicked || anyPartial);
            }}
            disabled={count === 0}
            onChange={toggleAll}
          />
          <span className="label">
            {changes === null ? 'Changes' : `${count} changed ${count === 1 ? 'file' : 'files'}`}
          </span>
        </label>
        <Button
          variant="text"
          square
          className="muted"
          aria-label="Actions for the changes"
          disabled={count === 0}
          onClick={() => setChangesMenu(true)}
        >
          <MoreIcon size={18} />
        </Button>
      </div>

      {stash?.info && (
        <div className={styles.stashHolder} inert={opened !== null}>
          <StashRow stash={stash.info} now={stash.at} onOpen={() => setShowingStash(true)} />
        </div>
      )}

      <div className={styles.changeList} inert={opened !== null}>
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
            const someLines = change.path in partial && !excluded.has(change.path);
            return (
              <div key={change.path} className={styles.change}>
                <label className={styles.changeTick}>
                  <input
                    type="checkbox"
                    className={styles.check}
                    aria-label={`Commit ${change.path}`}
                    checked={!excluded.has(change.path)}
                    ref={(input) => {
                      if (input) input.indeterminate = someLines;
                    }}
                    onChange={() => toggle(change.path)}
                  />
                </label>
                <button type="button" className={styles.changeOpen} onClick={() => open(change.path)}>
                  <span className={styles.changeText}>
                    <span className="body ellipsis">{basename(change.path)}</span>
                    {(folder || someLines) && (
                      <span className="caption muted ellipsis">
                        {someLines && <span className="accent">SOME LINES{folder && ' · '}</span>}
                        {folder}
                      </span>
                    )}
                  </span>
                  <span className={cx('label', styles.kind, styles[`kind-${change.kind}`])} title={label}>
                    <span aria-hidden>{mark}</span>
                    <span className="visually-hidden">{label}</span>
                  </span>
                </button>
                <Button
                  variant="text"
                  square
                  className={cx('muted', styles.changeMore)}
                  aria-label={`Actions for ${change.path}`}
                  onClick={() => setActing(change)}
                >
                  <MoreIcon size={18} />
                </Button>
              </div>
            );
          })
        )}
      </div>

      <form
        className={cx(styles.commitBox, !composing && styles.commitBoxFolded)}
        inert={opened !== null}
        onSubmit={(event) => {
          event.preventDefault();
          void commit();
        }}
      >
        <button
          type="button"
          className={styles.commitToggle}
          aria-expanded={composing}
          onClick={() => setComposing((open) => !open)}
        >
          <span className={cx('title', 'accent')} aria-hidden>
            {composing ? '▾' : '▴'}
          </span>
          <span className={styles.changeText}>
            <span className="label">Commit message</span>
            {!composing && (
              <span className="caption muted ellipsis" role={lastCommit && !summary.trim() ? 'status' : undefined}>
                {folded}
              </span>
            )}
          </span>
          <span className="caption muted">{composing ? 'Hide' : 'Write'}</span>
        </button>
        {composing && (
          <>
            <TextField label="Summary" placeholder="What changed" value={summary} onChange={setSummary} autoFocus />
            <TextField
              label="Description"
              placeholder="Why (optional)"
              value={description}
              onChange={setDescription}
              rows={2}
            />
            <Button type="submit" variant="filled" className={cx(committing && 'cursor')} disabled={!canCommit}>
              {committing ? 'Committing' : commitLabel}
            </Button>
            {lastCommit && (
              <p className={cx('caption', styles.committed)} role="status">
                <span className="accent">✓</span> Committed <strong>{lastCommit.id}</strong> · {lastCommit.summary}
              </p>
            )}
            <button
              type="button"
              className={cx('caption', 'muted', styles.author)}
              onClick={() => setAskingIdentity(true)}
            >
              {identity ? `As ${identity.name} <${identity.email}> · change` : 'Set who commits'}
            </button>
          </>
        )}
      </form>

      {opened !== null && visible && (
        <DiffView
          path={path}
          file={opened}
          picking={{
            selection: selectionOf(opened),
            onSelect: onSelectOpened,
            onDiscardFile: () => {
              const change = changes?.find((found) => found.path === opened);
              if (change) setDiscarding({ kind: 'files', changes: [change], all: false });
            },
            onDiscardLines: (lines) => setDiscarding({ kind: 'lines', file: opened, lines }),
          }}
          onClose={close}
        />
      )}

      {changesMenu && changes && (
        <Dialog
          title="Changes"
          eyebrow={`${count} changed ${count === 1 ? 'file' : 'files'}`}
          onClose={() => setChangesMenu(false)}
        >
          <div className={styles.actionList}>
            <Button
              variant="text"
              listItem
              onClick={() => {
                setChangesMenu(false);
                if (stash?.info) setReplacingStash(true);
                else void stashChanges();
              }}
            >
              <span className="accent" aria-hidden>
                ›
              </span>
              Stash all changes
            </Button>
            <Button
              variant="text"
              tone="danger"
              listItem
              onClick={() => {
                setChangesMenu(false);
                setDiscarding({ kind: 'files', changes, all: true });
              }}
            >
              <span className="accent" aria-hidden>
                ›
              </span>
              Discard all changes…
            </Button>
          </div>
        </Dialog>
      )}
      {acting && (
        <ChangeActionsDialog
          change={acting}
          onClose={() => setActing(null)}
          onDiscard={() => {
            setActing(null);
            setDiscarding({ kind: 'files', changes: [acting], all: false });
          }}
        />
      )}
      {replacingStash && stash?.info && (
        <Dialog
          title="Replace the stash?"
          eyebrow={`STASH · ${branch}`}
          onClose={() => setReplacingStash(false)}
          actions={
            <>
              <Button variant="text" onClick={() => setReplacingStash(false)}>
                Cancel
              </Button>
              <Button variant="filled" tone="danger" onClick={() => void stashChanges()}>
                Replace
              </Button>
            </>
          }
        >
          <p className="body">
            {branch} already has stashed changes ({stash.info.files.length}{' '}
            {stash.info.files.length === 1 ? 'file' : 'files'}). Stashing again replaces them: those are lost.
          </p>
        </Dialog>
      )}
      {showingStash && stash?.info && (
        <StashDialog
          path={path}
          stash={stash.info}
          hasChanges={count > 0}
          now={stash.at}
          onClose={() => setShowingStash(false)}
          onDone={(message) => {
            setShowingStash(false);
            setStashTick((value) => value + 1);
            refresh();
            showSnackbar(message);
          }}
        />
      )}
      {discarding && (
        <DiscardDialog path={path} what={discarding} onClose={() => setDiscarding(null)} onDiscarded={discarded} />
      )}

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
