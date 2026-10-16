import { useCallback, useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import { useBackHandler } from '../../ui/back';
import { Button } from '../../ui/components';
import { cx } from '../../ui/cx';
import { BackIcon } from '../../ui/icons';
import { navigate } from '../../ui/motion';
import { diffTexts, type FileDiff } from '../git/diff';
import { DiffCounts, DiffLines } from '../git/DiffView';
import { errorMessage } from '../projects/errors';
import { basename } from '../projects/paths';
import { formatAgo } from '../projects/recents';
import type { FileVersion } from './fileHistory';
import styles from './VersionsView.module.css';

const when = (time: number) => new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * A file's earlier versions (#27), kept before it was overwritten, newest
 * first. One opens as what restoring it would do to the file as it is now:
 * green comes back, red goes. Restoring is an edit like any other (undo
 * takes it back), and how the file was just before is kept first.
 */
export function VersionsView({
  path,
  current,
  onRestore,
  onClose,
}: {
  path: string;
  /** The file's text now, unsaved edits included. */
  current: () => string;
  onRestore: (text: string) => void;
  onClose: () => void;
}) {
  const { fileHistory } = useServices();
  const [versions, setVersions] = useState<FileVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // when the list came: "3H AGO" is relative to it, which keeps rendering pure
  const [at, setAt] = useState(0);
  const [opened, setOpened] = useState<FileVersion | null>(null);
  useBackHandler(opened === null, onClose);
  const open = (version: FileVersion) => navigate('forward', () => setOpened(version));
  const close = useCallback(() => navigate('back', () => setOpened(null)), []);

  useEffect(() => {
    let active = true;
    fileHistory.versions(path).then(
      (found) => {
        if (!active) return;
        setVersions(found);
        setAt(Date.now());
      },
      (failure: unknown) => active && setError(errorMessage(failure)),
    );
    return () => {
      active = false;
    };
  }, [fileHistory, path]);

  return (
    <div className={styles.versions}>
      <div className={styles.head} inert={opened !== null}>
        <Button variant="text" square aria-label="Back to the file" onClick={onClose}>
          <BackIcon />
        </Button>
        <span className={styles.headText}>
          <span className="body ellipsis">Earlier versions</span>
          <span className="caption muted ellipsis">{basename(path)}</span>
        </span>
      </div>
      <div className={styles.list} inert={opened !== null}>
        {versions === null ? (
          error ? (
            <p className={cx('caption', 'accent', styles.note)}>✕ {error}</p>
          ) : (
            <p className={cx('label', 'cursor', styles.note)} data-loading>
              Looking for versions
            </p>
          )
        ) : versions.length === 0 ? (
          <div className={styles.empty}>
            <p className="title">No earlier versions yet</p>
            <p className="caption muted">
              Pepino keeps how a file was before it is first saved over, and before a branch switch rewrites it.
            </p>
          </div>
        ) : (
          versions.map((version) => (
            <button key={version.id} type="button" className={styles.version} onClick={() => open(version)}>
              <span className={styles.headText}>
                <span className="body ellipsis">{formatAgo(version.time, at)}</span>
                <span className="caption muted ellipsis">
                  {when(version.time)} · {version.reason}
                </span>
              </span>
              <span className="label accent" aria-hidden>
                ▸
              </span>
            </button>
          ))
        )}
      </div>
      {opened && (
        <VersionDiff path={path} version={opened} at={at} current={current} onRestore={onRestore} onClose={close} />
      )}
    </div>
  );
}

/** One version against the file now, and Restore. */
function VersionDiff({
  path,
  version,
  at,
  current,
  onRestore,
  onClose,
}: {
  path: string;
  version: FileVersion;
  at: number;
  current: () => string;
  onRestore: (text: string) => void;
  onClose: () => void;
}) {
  const { fileHistory } = useServices();
  const [loaded, setLoaded] = useState<{ text: string | null; diff: FileDiff } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useBackHandler(true, onClose);

  useEffect(() => {
    let active = true;
    fileHistory.read(path, version).then(
      (text) => {
        if (!active) return;
        const hunks = text === null ? [] : diffTexts(current(), text);
        setLoaded({ text, diff: { version: '', binary: false, tooLarge: false, hunks } });
      },
      (failure: unknown) => active && setError(errorMessage(failure)),
    );
    return () => {
      active = false;
    };
  }, [fileHistory, path, version, current]);

  const same = loaded !== null && loaded.diff.hunks.length === 0;
  const restorable = typeof loaded?.text === 'string' && !same;

  return (
    <div className={styles.versions}>
      <div className={styles.head}>
        <Button variant="text" square aria-label="Back to the versions" onClick={onClose}>
          <BackIcon />
        </Button>
        <span className={styles.headText}>
          <span className="body ellipsis">{formatAgo(version.time, at)}</span>
          <span className="caption muted ellipsis">
            {loaded === null ? (
              when(version.time)
            ) : loaded.text === null ? (
              'Not in this version'
            ) : same ? (
              'Same as the file now'
            ) : (
              <>
                Restoring it: <DiffCounts diff={loaded.diff} />
              </>
            )}
          </span>
        </span>
        <Button
          variant="filled"
          disabled={!restorable}
          onClick={() => typeof loaded?.text === 'string' && onRestore(loaded.text)}
        >
          Restore
        </Button>
      </div>
      {loaded === null ? (
        error ? (
          <p className={cx('caption', 'accent', styles.note)}>✕ {error}</p>
        ) : (
          <p className={cx('label', 'cursor', styles.note)} data-loading>
            Reading the version
          </p>
        )
      ) : same || loaded.text === null ? (
        <div className={styles.empty}>
          <p className="title">{same ? 'Nothing to restore' : 'Not in this version'}</p>
          <p className="caption muted">
            {same ? 'This version is the same as the file now.' : 'The file did not exist yet when it was kept.'}
          </p>
        </div>
      ) : (
        <DiffLines diff={loaded.diff} />
      )}
    </div>
  );
}
