import { type ReactNode, useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import { Button, Dialog, TextField } from '../../ui/components';
import { cx } from '../../ui/cx';
import { BranchIcon, OpenIcon, PlusIcon } from '../../ui/icons';
import { useSnackbar } from '../../ui/useSnackbar';
import { GitHubError, parseGitHubUrl, type PullRequest, type RepoRef } from '../github/github';
import { GitHubLoginDialog } from '../github/GitHubLoginDialog';
import { useGitHubAccount } from '../github/useGitHubAccount';
import { errorMessage } from '../projects/errors';
import type { SyncState } from './engine';
import styles from './SyncBar.module.css';

/*
 * Pull requests (#34), as GitHub Desktop offers them: on a branch other than
 * the repository's default one, a row under the sync bar either opens the
 * branch's pull request on GitHub or creates one: title (the last commit's
 * by default), description and base. GitHub only sees what was pushed, so
 * a branch not published, or with commits to push, says so first.
 */

type Known = { repo: RepoRef; defaultBranch: string; pullRequest: PullRequest | null };

export function PullRequestRow({ path, branch, state }: { path: string; branch: string; state: SyncState }) {
  const { git, github } = useServices();
  const showSnackbar = useSnackbar();
  const account = useGitHubAccount();
  const [known, setKnown] = useState<Known | null>(null);
  const [failed, setFailed] = useState<GitHubError | null>(null);
  const [creating, setCreating] = useState(false);
  const [signingIn, setSigningIn] = useState(false);

  // The repository on GitHub, its default branch and this branch's pull request; again once signed in
  useEffect(() => {
    let active = true;
    (async () => {
      const repo = parseGitHubUrl(await git.originUrl(path));
      if (!repo || !account) return null;
      return { repo, ...(await github.pullRequestFor(repo, branch)) };
    })().then(
      (found) => {
        if (!active) return;
        setKnown(found);
        setFailed(null);
      },
      (error: unknown) => {
        if (!active) return;
        setKnown(null);
        setFailed(error instanceof GitHubError ? error : new GitHubError('FAILED', errorMessage(error)));
      },
    );
    return () => {
      active = false;
    };
  }, [git, github, path, branch, account]);

  if (signingIn)
    return <GitHubLoginDialog onClose={() => setSigningIn(false)} onSignedIn={() => setSigningIn(false)} />;

  if (account === null || failed?.code === 'UNAUTHORIZED') {
    return (
      <Row
        icon={<BranchIcon size={20} />}
        title="Pull requests"
        detail="Sign in to GitHub to see and create them"
        onClick={() => setSigningIn(true)}
      />
    );
  }
  if (failed) {
    return null; // not a repository GitHub shows (or no connection): no row rather than a wrong one
  }
  if (!known || branch === known.defaultBranch) return null;

  if (known.pullRequest) {
    const pull = known.pullRequest;
    return (
      <Row
        icon={<OpenIcon size={20} />}
        title={`Pull request #${pull.number}${pull.draft ? ' · draft' : ''}`}
        detail={`${pull.title} · open on GitHub`}
        onClick={() => void github.openUrl(pull.url)}
      />
    );
  }

  const blocked = !state.upstream
    ? 'Publish the branch first: GitHub only sees what was pushed'
    : state.ahead > 0
      ? `Push your ${state.ahead === 1 ? 'commit' : `${state.ahead} commits`} first: GitHub only sees what was pushed`
      : null;
  return (
    <>
      <Row
        icon={<PlusIcon size={20} />}
        title="Create pull request"
        detail={blocked ?? `From ${branch} into ${known.defaultBranch}`}
        onClick={blocked ? undefined : () => setCreating(true)}
      />
      {creating && (
        <CreatePullRequestDialog
          path={path}
          repo={known.repo}
          head={branch}
          defaultBase={known.defaultBranch}
          onClose={() => setCreating(false)}
          onCreated={(pull) => {
            setCreating(false);
            setKnown({ ...known, pullRequest: pull });
            showSnackbar(`Pull request #${pull.number} created`);
          }}
        />
      )}
    </>
  );
}

function Row({
  icon,
  title,
  detail,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  /** Without it the row only says why it cannot be used yet. */
  onClick?: () => void;
}) {
  return (
    <div className={styles.bar}>
      <button type="button" className={styles.action} disabled={!onClick} onClick={onClick}>
        {icon}
        <span className={styles.text}>
          <span className={cx('body', 'ellipsis', styles.title)}>{title}</span>
          <span className="caption muted ellipsis">{detail}</span>
        </span>
        {onClick && (
          <span className={cx('label', 'accent')} aria-hidden>
            ▸
          </span>
        )}
      </button>
    </div>
  );
}

/** What GitHub refused, said plainly. */
function explain(error: unknown): string {
  if (error instanceof GitHubError) {
    switch (error.code) {
      case 'INVALID':
      case 'FORBIDDEN':
        return `GitHub refused it: ${error.message}`;
      case 'NOT_FOUND':
        return 'GitHub does not show this repository to you.';
      case 'NETWORK':
        return 'No connection to GitHub. Try again.';
      case 'RATE_LIMITED':
        return error.message;
    }
  }
  return errorMessage(error);
}

function CreatePullRequestDialog({
  path,
  repo,
  head,
  defaultBase,
  onClose,
  onCreated,
}: {
  path: string;
  repo: RepoRef;
  head: string;
  defaultBase: string;
  onClose: () => void;
  onCreated: (pull: PullRequest) => void;
}) {
  const { git, github } = useServices();
  const [title, setTitle] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [base, setBase] = useState(defaultBase);
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  // The title starts as the branch's last commit, like GitHub's for a one-commit branch
  useEffect(() => {
    let active = true;
    git.log(path, { limit: 1 }).then(
      ([last]) => active && setTitle((current) => current ?? last?.summary ?? head),
      () => active && setTitle((current) => current ?? head),
    );
    return () => {
      active = false;
    };
  }, [git, path, head]);

  const text = title ?? '';
  const valid = text.trim() !== '' && base !== head && !busy;
  const create = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(await github.createPullRequest({ ...repo, head, base, title: text.trim(), body: body.trim() }));
    } catch (failure) {
      if (failure instanceof GitHubError && failure.code === 'UNAUTHORIZED') setSigningIn(true);
      else setError(explain(failure));
      setBusy(false);
    }
  };

  if (signingIn)
    return <GitHubLoginDialog onClose={() => setSigningIn(false)} onSignedIn={() => setSigningIn(false)} />;
  if (choosing) {
    return (
      <BaseDialog
        repo={repo}
        head={head}
        current={base}
        onClose={() => setChoosing(false)}
        onChoose={(name) => {
          setBase(name);
          setChoosing(false);
        }}
      />
    );
  }

  return (
    <Dialog
      title="Create pull request"
      eyebrow={`${repo.owner}/${repo.repo}`}
      onClose={onClose}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="filled" className={cx(busy && 'cursor')} disabled={!valid} onClick={() => void create()}>
            {busy ? 'Creating' : 'Create'}
          </Button>
        </>
      }
    >
      <div className={styles.problem}>
        <div className={styles.merge}>
          <BranchIcon size={20} />
          <span className={styles.text}>
            <span className="caption muted">INTO</span>
            <span className="body ellipsis">
              {base} <span className="muted">← {head}</span>
            </span>
          </span>
          <Button variant="text" disabled={busy} onClick={() => setChoosing(true)}>
            Change
          </Button>
        </div>
        <TextField label="Title" value={text} onChange={setTitle} placeholder="What it does" />
        <TextField
          label="Description"
          value={body}
          onChange={setBody}
          placeholder="Why, and how to try it (optional)"
          rows={5}
        />
        {error && (
          <p className={cx('caption', styles.error)} role="alert">
            ✕ {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/** The base: one of the repository's branches on GitHub (not the branch itself). */
function BaseDialog({
  repo,
  head,
  current,
  onClose,
  onChoose,
}: {
  repo: RepoRef;
  head: string;
  current: string;
  onClose: () => void;
  onChoose: (name: string) => void;
}) {
  const { github } = useServices();
  const [branches, setBranches] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    github.remoteBranches(repo).then(
      (found) => active && setBranches(found.filter((name) => name !== head)),
      (failure: unknown) => {
        if (!active) return;
        setBranches([]);
        setError(explain(failure));
      },
    );
    return () => {
      active = false;
    };
  }, [github, repo, head]);

  return (
    <Dialog title="Base branch" eyebrow={`MERGE ${head} INTO…`} onClose={onClose}>
      {branches === null ? (
        <p className="label cursor" data-loading>
          Reading GitHub&apos;s branches
        </p>
      ) : error ? (
        <p className={cx('caption', styles.error)} role="alert">
          ✕ {error}
        </p>
      ) : (
        <div className={styles.bases} role="listbox" aria-label="Base branch">
          {branches.map((name) => (
            <button
              key={name}
              type="button"
              role="option"
              aria-selected={name === current}
              className={cx(styles.base, name === current && styles.baseCurrent)}
              onClick={() => onChoose(name)}
            >
              <BranchIcon size={18} />
              <span className="body ellipsis">{name}</span>
            </button>
          ))}
        </div>
      )}
    </Dialog>
  );
}
