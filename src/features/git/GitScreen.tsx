import { type ReactNode, useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import { TopBar } from '../../app/TopBar';
import { Button, Dialog, TextField } from '../../ui/components';
import { cx } from '../../ui/cx';
import { BranchIcon, FolderIcon, PlusIcon } from '../../ui/icons';
import { useSnackbar } from '../../ui/useSnackbar';
import { errorMessage } from '../projects/errors';
import { isValidEntryName, sortEntries } from '../projects/files';
import { findRepositories, isReservedName, type ProjectInfo } from '../projects/projects';
import { useDirectoryListing } from '../projects/useDirectoryListing';
import { useFolderChanges } from '../projects/useFolderChanges';
import { ChangesView } from './ChangesView';
import type { RepoInfo } from './engine';
import styles from './GitScreen.module.css';

/*
 * GIT works like GitHub Desktop on the one active project, which the editor
 * shares: choosing a repository here makes it the active project everywhere.
 * Cloning (#29, #31, #32) shows already and turns on with GitHub sign-in.
 */
interface GitScreenProps {
  project: ProjectInfo | null;
  /** Makes [path] the active project. */
  onOpen: (path: string) => void;
}

export function GitScreen({ project, onOpen }: GitScreenProps) {
  return project ? <GitProject key={project.path} project={project} onOpen={onOpen} /> : <GitStart onOpen={onOpen} />;
}

/** The local repositories, re-read whenever the top of the space changes. */
function useRepositories(): ProjectInfo[] | null {
  const { projectSpace } = useServices();
  const [tick, setTick] = useState(0);
  const [repos, setRepos] = useState<ProjectInfo[] | null>(null);
  useFolderChanges('', () => setTick((value) => value + 1));
  useEffect(() => {
    let active = true;
    findRepositories(projectSpace).then(
      (found) => active && setRepos(found),
      () => active && setRepos([]),
    );
    return () => {
      active = false;
    };
  }, [projectSpace, tick]);
  return repos;
}

/** GitHub Desktop's "Let's get started": clone, create, or add a repository already on the device. */
function GitStart({ onOpen }: { onOpen: (path: string) => void }) {
  const repos = useRepositories();
  const [creating, setCreating] = useState(false);
  return (
    <div className={styles.screen}>
      <TopBar title="Git" subtitle="NO REPOSITORY" label="Search commands · Git" />
      <div className={styles.scroll}>
        <p className={cx('body', styles.intro)}>
          <span className="label accent">// Let&apos;s get started</span>
          Git works on one repository at a time: the project the editor has open. Pick one to start.
        </p>
        <div className={styles.actions}>
          <ActionCard icon={<BranchIcon size={22} />} title="Clone a repository" detail="From GitHub · Sign in first" />
          <ActionCard
            icon={<PlusIcon size={22} />}
            title="Create a new repository"
            detail="A new folder, or one of ~/projects"
            onClick={() => setCreating(true)}
          />
        </div>
        <h2 className={cx('label', 'muted', styles.heading)}>
          <span className="accent">//</span> Add an existing repository
        </h2>
        <RepositoryList repos={repos} activePath={null} onOpen={onOpen} />
      </div>
      {creating && (
        <CreateRepositoryDialog
          onClose={() => setCreating(false)}
          onCreated={(path) => {
            setCreating(false);
            onOpen(path);
          }}
        />
      )}
    </div>
  );
}

/** A big action; without [onClick] it is still to come ("SOON"). */
function ActionCard({
  icon,
  title,
  detail,
  onClick,
  busy = false,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  onClick?: () => void;
  busy?: boolean;
}) {
  return (
    <button type="button" className={styles.action} disabled={!onClick || busy} onClick={onClick}>
      <span className={styles.actionIcon} aria-hidden>
        {icon}
      </span>
      <span className={styles.actionText}>
        <span className={cx('body', busy && 'cursor')}>{title}</span>
        <span className="caption muted">{detail}</span>
      </span>
      {onClick ? (
        <span className={cx('label', 'accent')} aria-hidden>
          ▸
        </span>
      ) : (
        <span className={cx('caption', styles.soon)}>SOON</span>
      )}
    </button>
  );
}

function nameError(name: string, taken: ReadonlySet<string>): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return null;
  if (isReservedName(trimmed)) return 'Reserved name';
  if (!isValidEntryName(trimmed)) return 'Invalid name';
  return taken.has(trimmed) ? 'Already in ~/projects: pick it below' : null;
}

/**
 * GitHub Desktop's "Create a new repository": a new folder in ~/projects, or
 * one already there without git, becomes a repository and the active project.
 */
function CreateRepositoryDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (path: string) => void }) {
  const { projectSpace, git } = useServices();
  const showSnackbar = useSnackbar();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const listing = useDirectoryListing(projectSpace, '', 0, true);
  const folders = listing?.ok ? sortEntries(listing.entries, 'name').filter((entry) => entry.isDirectory) : [];
  const withoutGit = listing?.ok ? folders.filter((folder) => !listing.repos.has(folder.path)) : [];
  const error = nameError(name, new Set(folders.map((folder) => folder.name)));
  const valid = name.trim() !== '' && error === null;

  const initialize = async (path: string, create: boolean) => {
    setBusy(true);
    try {
      if (create) await projectSpace.createDirectory(path);
      await git.init(path);
      onCreated(path);
    } catch (failure) {
      showSnackbar(`Error: ${errorMessage(failure)}`);
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="New repository"
      eyebrow="IN ~/projects"
      onClose={onClose}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="filled"
            className={cx(busy && 'cursor')}
            disabled={!valid || busy}
            onClick={() => void initialize(name.trim(), true)}
          >
            {busy ? 'Creating' : 'Create'}
          </Button>
        </>
      }
    >
      <TextField
        label="Name"
        placeholder="my-app"
        value={name}
        onChange={setName}
        error={error}
        autoFocus
        onSubmit={() => valid && !busy && void initialize(name.trim(), true)}
      />
      {withoutGit.length > 0 && (
        <div className={styles.pick}>
          <span className="label muted">
            <span className="accent">//</span> Or a folder without git
          </span>
          <div className={styles.pickList}>
            {withoutGit.map((folder) => (
              <Button
                key={folder.path}
                variant="text"
                listItem
                className={cx('body', styles.pickFolder)}
                disabled={busy}
                onClick={() => void initialize(folder.path, false)}
              >
                <FolderIcon size={20} />
                <span className="ellipsis">{folder.name}</span>
              </Button>
            ))}
          </div>
        </div>
      )}
    </Dialog>
  );
}

function RepositoryList({
  repos,
  activePath,
  onOpen,
}: {
  repos: ProjectInfo[] | null;
  activePath: string | null;
  onOpen: (path: string) => void;
}) {
  if (repos === null) {
    return (
      <p className={cx('label', 'cursor', styles.note)} data-loading>
        Looking for repositories
      </p>
    );
  }
  if (repos.length === 0) {
    return <p className={cx('caption', 'muted', styles.note)}>No git repositories in ~/projects yet.</p>;
  }
  return (
    <div className={styles.list}>
      {repos.map((repo) => {
        const active = repo.path === activePath;
        return (
          <button
            key={repo.path}
            type="button"
            className={cx(styles.repo, active && styles.repoActive)}
            aria-current={active ? 'true' : undefined}
            onClick={() => onOpen(repo.path)}
          >
            <span className={styles.repoIcon} aria-hidden>
              <BranchIcon size={22} />
            </span>
            <span className={styles.actionText}>
              <span className={cx('body', 'ellipsis', styles.repoName)}>{repo.name}</span>
              <span className="caption muted ellipsis">
                {active && <span className="accent">ACTIVE · </span>}~/projects/{repo.path}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The active project: the "Current repository" switcher, then git, or the offer to start it. */
function GitProject({ project, onOpen }: { project: ProjectInfo; onOpen: (path: string) => void }) {
  const { git } = useServices();
  const showSnackbar = useSnackbar();
  const [choosing, setChoosing] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [tick, setTick] = useState(0);
  // undefined while reading; null when the project is not a repository
  const [repo, setRepo] = useState<RepoInfo | null | undefined>(undefined);
  // `.git` appearing or going away changes the answer
  useFolderChanges(project.path, () => setTick((value) => value + 1));
  useEffect(() => {
    let active = true;
    git.info(project.path).then(
      (info) => active && setRepo(info),
      (error: unknown) => {
        console.error('Cannot read the repository', error);
        if (active) setRepo(null);
      },
    );
    return () => {
      active = false;
    };
  }, [git, project.path, tick]);

  const initialize = () => {
    setInitializing(true);
    git.init(project.path).then(
      (info) => {
        setInitializing(false);
        setRepo(info);
      },
      (error: unknown) => {
        setInitializing(false);
        showSnackbar(`Error: ${errorMessage(error)}`);
      },
    );
  };

  return (
    <div className={styles.screen}>
      <TopBar
        title="Git"
        subtitle={`${project.name} · ${repo === null ? 'NOT A REPOSITORY' : 'REPOSITORY'}`}
        label="Search commands · Git"
      />
      <button type="button" className={styles.current} onClick={() => setChoosing(true)}>
        <BranchIcon size={20} />
        <span className={styles.actionText}>
          <span className="caption muted">
            CURRENT REPOSITORY{repo && <span className={styles.branch}> · {repo.branch}</span>}
          </span>
          <span className={cx('body', 'ellipsis', styles.repoName)}>{project.name}</span>
        </span>
        <span className="muted" aria-hidden>
          ▾
        </span>
      </button>
      {repo === undefined ? (
        <span hidden data-loading />
      ) : repo ? (
        <>
          <div className={styles.tabs} role="tablist" aria-label="Repository">
            <button type="button" role="tab" aria-selected className={cx('label', styles.tab)}>
              Changes
            </button>
            <button type="button" role="tab" aria-selected={false} className={cx('label', styles.tab)} disabled>
              History <span className={cx('caption', styles.soon)}>SOON</span>
            </button>
          </div>
          <ChangesView path={project.path} branch={repo.branch} onCommitted={() => setTick((value) => value + 1)} />
        </>
      ) : (
        <div className={styles.notRepo}>
          <span className="label accent">// No git yet</span>
          <p className="title">This folder is not a git repository</p>
          <p className="caption muted">
            Initialize one to track changes in <strong>{project.name}</strong>. Nothing changes until you ask.
          </p>
          <ActionCard
            icon={<PlusIcon size={22} />}
            title={initializing ? 'Initializing' : 'Initialize repository'}
            detail={`git init in ${project.name}, on main`}
            onClick={initialize}
            busy={initializing}
          />
        </div>
      )}
      {choosing && (
        <ChooseRepository
          activePath={project.path}
          onClose={() => setChoosing(false)}
          onOpen={(path) => {
            setChoosing(false);
            if (path !== project.path) onOpen(path);
          }}
        />
      )}
    </div>
  );
}

function ChooseRepository({
  activePath,
  onClose,
  onOpen,
}: {
  activePath: string;
  onClose: () => void;
  onOpen: (path: string) => void;
}) {
  const repos = useRepositories();
  return (
    <Dialog title="Repositories" eyebrow="SWITCH THE ACTIVE PROJECT" onClose={onClose}>
      <RepositoryList repos={repos} activePath={activePath} onOpen={onOpen} />
    </Dialog>
  );
}
