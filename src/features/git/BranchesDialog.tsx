import { useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import { Button, Dialog, TextField } from '../../ui/components';
import { cx } from '../../ui/cx';
import { BranchIcon, CloseIcon, PlusIcon } from '../../ui/icons';
import { errorMessage } from '../projects/errors';
import { type Branch, GitError, type RepoInfo } from './engine';
import styles from './GitScreen.module.css';

/**
 * GitHub Desktop's "Current branch": every local branch (tap one to switch
 * to it), a new branch from the current commit, and deleting the others.
 * Below, GitHub's branches not local yet (after a clone, all but the
 * default one): tapping one makes its local branch and switches to it.
 */
export function BranchesDialog({
  path,
  repo,
  onSwitched,
  onClose,
}: {
  /** The repository (the active project). */
  path: string;
  repo: RepoInfo;
  onSwitched: (info: RepoInfo) => void;
  onClose: () => void;
}) {
  const { git } = useServices();
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [tick, setTick] = useState(0);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{ name: string; notMerged: boolean } | null>(null);
  // Switching with uncommitted changes (#139): where they go
  const [leaving, setLeaving] = useState<{ target: string; changes: number; stashed: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    git.branches(path).then(
      (found) => active && setBranches(found),
      (failure: unknown) => {
        if (!active) return;
        setBranches([]);
        setError(errorMessage(failure));
      },
    );
    return () => {
      active = false;
    };
  }, [git, path, tick]);

  const run = async (action: () => Promise<RepoInfo>) => {
    setBusy(true);
    setError(null);
    try {
      onSwitched(await action());
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  };

  /** Switches to [target]; with changes, asks first whether they stay here (stashed) or come along. */
  const switchTo = async (target: string) => {
    setError(null);
    try {
      const [changes, stash] = await Promise.all([git.status(path), git.stash(path)]);
      if (changes.length > 0) {
        setLeaving({ target, changes: changes.length, stashed: stash !== null });
        return;
      }
    } catch {
      // Unknown: switch as before, which refuses when changes are in the way
    }
    void run(() => git.checkout(path, target));
  };

  const taken = new Set(branches?.map((branch) => branch.name));
  const local = branches?.filter((branch) => !branch.remote) ?? [];
  const remote = branches?.filter((branch) => branch.remote) ?? [];
  const nameError = name.trim() && taken.has(name.trim()) ? 'There is already a branch with this name' : null;
  const canCreate = repo.hasCommits && name.trim() !== '' && !nameError && !busy;

  const remove = async (branch: string, force: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await git.deleteBranch(path, branch, { force });
      setDeleting(null);
      setTick((value) => value + 1);
    } catch (failure) {
      if (failure instanceof GitError && failure.code === 'NOT_MERGED') setDeleting({ name: branch, notMerged: true });
      else {
        setDeleting(null);
        setError(errorMessage(failure));
      }
    } finally {
      setBusy(false);
    }
  };

  return leaving ? (
    <Dialog title="You have changes" eyebrow={`${repo.branch} → ${leaving.target}`} onClose={() => setLeaving(null)}>
      <div className={styles.branches}>
        <p className="body">
          {leaving.changes} changed {leaving.changes === 1 ? 'file' : 'files'} on {repo.branch}. Where should{' '}
          {leaving.changes === 1 ? 'it' : 'they'} go?
        </p>
        <div className={styles.actionList}>
          <Button
            variant="text"
            listItem
            disabled={busy}
            onClick={() => {
              const { target } = leaving;
              void run(async () => {
                await git.stashChanges(path);
                return git.checkout(path, target);
              });
            }}
          >
            <span className="accent" aria-hidden>
              ›
            </span>
            <span className={styles.changeText}>
              <span className="body">Leave them on {repo.branch}</span>
              <span className="caption muted">
                Stashed, to restore when you come back
                {leaving.stashed ? ': replaces the changes stashed there before' : ''}
              </span>
            </span>
          </Button>
          <Button
            variant="text"
            listItem
            disabled={busy}
            onClick={() => {
              const { target } = leaving;
              void run(() => git.checkout(path, target));
            }}
          >
            <span className="accent" aria-hidden>
              ›
            </span>
            <span className={styles.changeText}>
              <span className="body">Bring them to {leaving.target}</span>
              <span className="caption muted">They stay in Changes, on the other branch</span>
            </span>
          </Button>
        </div>
        {error && (
          <p className={cx('caption', styles.branchError)} role="alert">
            ✕ {error}
          </p>
        )}
      </div>
    </Dialog>
  ) : (
    <Dialog title="Branches" eyebrow={`CURRENT · ${repo.branch}`} onClose={onClose}>
      <div className={styles.branches}>
        <form
          className={styles.newBranch}
          onSubmit={(event) => {
            event.preventDefault();
            if (canCreate) void run(() => git.createBranch(path, name.trim()));
          }}
        >
          <TextField
            label={`New branch from ${repo.branch}`}
            placeholder="feature/login"
            value={name}
            onChange={setName}
            error={nameError}
          />
          <Button type="submit" variant="filled" disabled={!canCreate}>
            <PlusIcon size={18} />
            Create
          </Button>
        </form>
        {!repo.hasCommits && (
          <p className="caption muted">Make the first commit to create branches: a branch starts at a commit.</p>
        )}
        {error && (
          <p className={cx('caption', styles.branchError)} role="alert">
            ✕ {error}
          </p>
        )}
        <div className={styles.list}>
          {branches === null ? (
            <p className={cx('label', 'cursor', styles.note)} data-loading>
              Reading branches
            </p>
          ) : (
            [...local]
              .sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name))
              .map((branch) => (
                <div key={branch.name} className={cx(styles.branchRow, branch.current && styles.repoActive)}>
                  <button
                    type="button"
                    className={styles.branchMain}
                    aria-current={branch.current ? 'true' : undefined}
                    disabled={branch.current || busy}
                    onClick={() => void switchTo(branch.name)}
                  >
                    <BranchIcon size={20} />
                    <span className={cx('body', 'ellipsis', styles.repoName)}>{branch.name}</span>
                    {branch.current && <span className="caption accent">CURRENT</span>}
                  </button>
                  {!branch.current && (
                    <Button
                      variant="text"
                      square
                      className="muted"
                      aria-label={`Delete branch ${branch.name}`}
                      disabled={busy}
                      onClick={() => setDeleting({ name: branch.name, notMerged: false })}
                    >
                      <CloseIcon size={18} />
                    </Button>
                  )}
                </div>
              ))
          )}
        </div>
        {remote.length > 0 && (
          <>
            <h3 className={cx('label', 'muted', styles.branchHeading)}>
              <span className="accent">//</span> On GitHub
            </h3>
            <div className={styles.list}>
              {remote.map((branch) => (
                <div key={branch.name} className={styles.branchRow}>
                  <button
                    type="button"
                    className={styles.branchMain}
                    aria-label={`Switch to ${branch.name}, from GitHub`}
                    disabled={busy}
                    onClick={() => void switchTo(branch.name)}
                  >
                    <BranchIcon size={20} />
                    <span className={cx('body', 'ellipsis', styles.repoName)}>{branch.name}</span>
                    <span className="caption muted">ORIGIN</span>
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {deleting && (
        <Dialog
          title={`Delete ${deleting.name}?`}
          eyebrow="BRANCH"
          onClose={() => setDeleting(null)}
          actions={
            <>
              <Button variant="text" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button variant="filled" disabled={busy} onClick={() => void remove(deleting.name, deleting.notMerged)}>
                {deleting.notMerged ? 'Delete anyway' : 'Delete'}
              </Button>
            </>
          }
        >
          <p className={cx('body', styles.deleteText)}>
            {deleting.notMerged ? (
              <>
                <strong>{deleting.name}</strong> has commits that are on no other branch. Deleting it loses them.
              </>
            ) : (
              <>
                The branch <strong>{deleting.name}</strong> goes; its commits stay on the branches that have them.
              </>
            )}
          </p>
        </Dialog>
      )}
    </Dialog>
  );
}
