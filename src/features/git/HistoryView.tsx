import { type UIEvent, useCallback, useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import { useBackHandler } from '../../ui/back';
import { Button } from '../../ui/components';
import { cx } from '../../ui/cx';
import { BackIcon } from '../../ui/icons';
import { navigate } from '../../ui/motion';
import { useSnackbar } from '../../ui/useSnackbar';
import { errorMessage } from '../projects/errors';
import { basename, parentPath } from '../projects/paths';
import { formatAgo } from '../projects/recents';
import { KIND_MARKS } from './changeKinds';
import { DiffView } from './DiffView';
import { type FileChange, GitError, type LastCommit, LOG_PAGE, type LogEntry, shortId } from './engine';
import styles from './GitScreen.module.css';
import { PushedDialog, type Reopened, type RevertProblem, RevertProblemDialog } from './UndoCommit';

/** How close to the end of the list (px) the next page starts loading. */
const LOAD_MORE_MARGIN = 600;

/** The history, a page at a time; [loadMore] reads the next one while there may be more. */
function useHistory(path: string, refreshKey: number) {
  const { git } = useServices();
  const showSnackbar = useSnackbar();
  const [commits, setCommits] = useState<LogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // the last page was full: there may be more
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  // when the first page came: "3H AGO" is relative to it, which keeps rendering pure
  const [at, setAt] = useState(0);

  useEffect(() => {
    let active = true;
    git.log(path, { limit: LOG_PAGE }).then(
      (page) => {
        if (!active) return;
        setCommits(page);
        setMore(page.length === LOG_PAGE);
        setAt(Date.now());
      },
      (failure: unknown) => active && setError(errorMessage(failure)),
    );
    return () => {
      active = false;
    };
  }, [git, path, refreshKey]);

  const loadMore = () => {
    if (!commits || !more || loading) return;
    setLoading(true);
    git.log(path, { skip: commits.length, limit: LOG_PAGE }).then(
      (page) => {
        setCommits((current) => [...(current ?? []), ...page]);
        setMore(page.length === LOG_PAGE);
        setLoading(false);
      },
      (failure: unknown) => {
        showSnackbar(`Error: ${errorMessage(failure)}`);
        setLoading(false);
      },
    );
  };

  return { commits, error, more, at, loadMore };
}

/**
 * GitHub Desktop's History: the commits of the current branch, newest first,
 * with who made each and when. Tapping one shows what it changed.
 */
export function HistoryView({
  path,
  refreshKey,
  onReopened,
  onReverted,
}: {
  path: string;
  /** Changes after a commit, a revert, a pull or a push: the history is read again. */
  refreshKey: number;
  onReopened: (reopened: Reopened) => void;
  /** A revert made a new commit (#142). */
  onReverted: () => void;
}) {
  const { commits, error, more, at, loadMore } = useHistory(path, refreshKey);
  const [opened, setOpened] = useState<LogEntry | null>(null);
  const open = (commit: LogEntry) => navigate('forward', () => setOpened(commit));
  const close = useCallback(() => navigate('back', () => setOpened(null)), []);
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const list = event.currentTarget;
    if (list.scrollTop + list.clientHeight > list.scrollHeight - LOAD_MORE_MARGIN) loadMore();
  };

  return (
    <div className={styles.changes}>
      <div className={styles.changeList} inert={opened !== null} onScroll={onScroll}>
        {commits === null ? (
          error ? (
            <p className={cx('caption', styles.note, styles.diffError)}>✕ {error}</p>
          ) : (
            <p className={cx('label', 'cursor', styles.note)} data-loading>
              Reading the history
            </p>
          )
        ) : commits.length === 0 ? (
          <div className={styles.noChanges}>
            <p className="title">No commits yet</p>
            <p className="caption muted">Commit your changes and they show up here, newest first.</p>
          </div>
        ) : (
          <>
            {commits.map((commit) => (
              <button key={commit.id} type="button" className={styles.commitRow} onClick={() => open(commit)}>
                <span className={styles.changeText}>
                  <span className="body ellipsis">{commit.summary}</span>
                  <span className="caption muted ellipsis">
                    {commit.author} · {formatAgo(commit.time, at)}
                  </span>
                </span>
                <span className={cx('caption', styles.commitId)}>{shortId(commit.id)}</span>
              </button>
            ))}
            {more && <p className={cx('label', 'cursor', 'muted', styles.note)}>More commits</p>}
          </>
        )}
      </div>
      {opened && (
        <CommitView
          path={path}
          commit={opened}
          newest={commits?.[0]?.id === opened.id}
          onClose={close}
          onReopened={onReopened}
          onReverted={() => {
            close();
            onReverted();
          }}
        />
      )}
    </div>
  );
}

/**
 * One commit: its whole message, who and when, and the files it changed,
 * each opening its diff. Any can be reverted (#142); the branch's newest
 * one can also be undone (#140) or amended (#141).
 */
function CommitView({
  path,
  commit,
  newest,
  onClose,
  onReopened,
  onReverted,
}: {
  path: string;
  commit: LogEntry;
  newest: boolean;
  onClose: () => void;
  onReopened: (reopened: Reopened) => void;
  onReverted: () => void;
}) {
  const { git } = useServices();
  const showSnackbar = useSnackbar();
  const [changes, setChanges] = useState<FileChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<string | null>(null);
  // the open diff takes back first
  useBackHandler(file === null, onClose);
  const openFile = (path: string) => navigate('forward', () => setFile(path));
  const closeFile = useCallback(() => navigate('back', () => setFile(null)), []);

  useEffect(() => {
    let active = true;
    git.commitChanges(path, commit.id).then(
      (found) => active && setChanges(found),
      (failure: unknown) => active && setError(errorMessage(failure)),
    );
    return () => {
      active = false;
    };
  }, [git, path, commit.id]);

  // The newest commit: whether it can be undone or amended
  const [last, setLast] = useState<LastCommit | null>(null);
  const [undoing, setUndoing] = useState(false);
  // Refused: Already on GitHub, for an undo or an amend
  const [pushed, setPushed] = useState<'undo' | 'amend' | null>(null);
  useEffect(() => {
    if (!newest) return;
    let active = true;
    git.lastCommit(path).then(
      (found) => active && setLast(found?.commit.id === commit.id ? found : null),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [git, path, commit.id, newest]);

  const undo = async () => {
    if (last?.onGitHub) {
      setPushed('undo');
      return;
    }
    setUndoing(true);
    try {
      onReopened({ commit: await git.undoCommit(path), amend: false });
      showSnackbar(`Undid “${commit.summary}”: its changes are back in Changes`);
    } catch (error) {
      if (error instanceof GitError && error.code === 'PUSHED') setPushed('undo');
      else showSnackbar(`Error: ${errorMessage(error)}`);
      setUndoing(false);
    }
  };

  const [reverting, setReverting] = useState(false);
  const [revertProblem, setRevertProblem] = useState<RevertProblem | null>(null);
  const revert = async () => {
    setPushed(null);
    setReverting(true);
    try {
      const made = await git.revert(path, commit.id);
      showSnackbar(`Reverted “${commit.summary}” with ${made.id}`);
      onReverted();
    } catch (error) {
      if (error instanceof GitError && (error.code === 'MERGE_CONFLICT' || error.code === 'CONFLICT')) {
        setRevertProblem({ clash: error.code === 'MERGE_CONFLICT', paths: error.paths });
      } else showSnackbar(`Error: ${errorMessage(error)}`);
      setReverting(false);
    }
  };
  const busy = undoing || reverting;

  const count = changes?.length ?? 0;

  return (
    <div className={styles.diff}>
      <div className={styles.diffHead} inert={file !== null}>
        <Button variant="text" square aria-label="Back to the history" onClick={onClose}>
          <BackIcon />
        </Button>
        <span className={styles.changeText}>
          <span className="body ellipsis">{commit.summary}</span>
          <span className="caption muted ellipsis">
            {shortId(commit.id)}
            {changes && ` · ${count} changed ${count === 1 ? 'file' : 'files'}`}
          </span>
        </span>
      </div>
      <div className={styles.changeList} inert={file !== null}>
        <div className={styles.commitInfo}>
          {commit.description && <p className={cx('body', styles.commitDescription)}>{commit.description}</p>}
          <p className="caption">
            {commit.author} <span className="muted">&lt;{commit.email}&gt;</span>
          </p>
          <p className="caption muted">
            {new Date(commit.time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
          </p>
          <p className={cx('caption', 'muted', styles.commitHash)}>{commit.id}</p>
        </div>
        {!last?.merge && (
          <div className={styles.undoCommit}>
            {last && (
              <div className={styles.undoActions}>
                <Button
                  variant="outlined"
                  disabled={busy}
                  onClick={() => (last.onGitHub ? setPushed('amend') : onReopened({ commit, amend: true }))}
                >
                  Amend commit
                </Button>
                <Button
                  variant="outlined"
                  className={cx(undoing && 'cursor')}
                  disabled={busy}
                  onClick={() => void undo()}
                >
                  {undoing ? 'Undoing' : 'Undo commit'}
                </Button>
              </div>
            )}
            <Button
              variant="outlined"
              className={cx(reverting && 'cursor')}
              disabled={busy}
              onClick={() => void revert()}
            >
              {reverting ? 'Reverting' : 'Revert commit'}
            </Button>
            <p className="caption muted">
              {last && !last.onGitHub
                ? 'Amend changes its message or adds changes to it. Undo puts its changes back in Changes, uncommitted. Revert adds a new commit that undoes it.'
                : last
                  ? 'Already on GitHub: it can no longer be amended or undone here. Revert adds a new commit that undoes it, which is safe.'
                  : 'Revert adds a new commit that undoes its changes, safe even when GitHub has it.'}
            </p>
          </div>
        )}
        {changes === null ? (
          error ? (
            <p className={cx('caption', styles.note, styles.diffError)}>✕ {error}</p>
          ) : (
            <p className={cx('label', 'cursor', styles.note)} data-loading>
              Reading the files
            </p>
          )
        ) : (
          changes.map((change) => {
            const folder = parentPath(change.path);
            const { mark, label } = KIND_MARKS[change.kind];
            return (
              <button
                key={change.path}
                type="button"
                className={styles.commitRow}
                onClick={() => openFile(change.path)}
              >
                <span className={styles.changeText}>
                  <span className="body ellipsis">{basename(change.path)}</span>
                  {folder && <span className="caption muted ellipsis">{folder}</span>}
                </span>
                <span className={cx('label', styles.kind, styles[`kind-${change.kind}`])} title={label}>
                  <span aria-hidden>{mark}</span>
                  <span className="visually-hidden">{label}</span>
                </span>
              </button>
            );
          })
        )}
      </div>
      {file !== null && <DiffView path={path} file={file} commit={commit.id} onClose={closeFile} />}
      {pushed && (
        <PushedDialog
          commit={commit}
          amend={pushed === 'amend'}
          onClose={() => setPushed(null)}
          onRevert={() => void revert()}
        />
      )}
      {revertProblem && (
        <RevertProblemDialog commit={commit} problem={revertProblem} onClose={() => setRevertProblem(null)} />
      )}
    </div>
  );
}
