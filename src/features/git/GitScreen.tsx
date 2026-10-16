import { type ReactNode, useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import { TopBar } from '../../app/TopBar';
import { Button, Dialog, TextField } from '../../ui/components';
import { cx } from '../../ui/cx';
import { BranchIcon, FolderIcon, PlusIcon, ProjectIcon } from '../../ui/icons';
import { useSnackbar } from '../../ui/useSnackbar';
import { useGitHubAccount } from '../github/useGitHubAccount';
import { errorMessage } from '../projects/errors';
import { FolderPicker } from '../projects/FolderPicker';
import { basename, joinPath } from '../projects/paths';
import { hasGitDir, type ProjectInfo } from '../projects/projects';
import { useDirectoryListing } from '../projects/useDirectoryListing';
import { useFolderChanges } from '../projects/useFolderChanges';
import { useFolderStack } from '../projects/useFolderStack';
import { BranchesDialog } from './BranchesDialog';
import { ChangesView } from './ChangesView';
import { CloneRepositoryDialog } from './CloneDialog';
import type { RepoInfo } from './engine';
import styles from './GitScreen.module.css';
import { HistoryView } from './HistoryView';
import { GitMark, LocationDialog } from './LocationDialog';
import { isGitDir, nameError, shown } from './locations';

/*
 * GIT works like GitHub Desktop on the one active project, which the editor
 * shares: choosing a repository here makes it the active project everywhere.
 * Cloning picks one of the user's GitHub repositories (#31, #32).
 */
interface GitScreenProps {
  project: ProjectInfo | null;
  /** Makes [path] the active project. */
  onOpen: (path: string) => void;
}

export function GitScreen({ project, onOpen }: GitScreenProps) {
  return project ? <GitProject key={project.path} project={project} onOpen={onOpen} /> : <GitStart onOpen={onOpen} />;
}

/** The repositories added to GIT, re-read when the list or the top of the space changes. */
function useRepositories(): ProjectInfo[] | null {
  const { repositories } = useServices();
  const [tick, setTick] = useState(0);
  const [repos, setRepos] = useState<ProjectInfo[] | null>(null);
  const refresh = () => setTick((value) => value + 1);
  useFolderChanges('', refresh);
  useEffect(() => repositories.subscribe(refresh), [repositories]);
  useEffect(() => {
    let active = true;
    repositories.load().then(
      (found) => active && setRepos(found),
      () => active && setRepos([]),
    );
    return () => {
      active = false;
    };
  }, [repositories, tick]);
  return repos;
}

/** The ways to bring a repository into the list, each a dialog over GIT. */
type RepositoryDialog =
  { kind: 'clone' } | { kind: 'create' } | { kind: 'initialize' } | { kind: 'add'; added: readonly ProjectInfo[] };

/** [dialog], open; [onDone] gets the repository it created, initialized or added. */
function RepositoryDialogs({
  dialog,
  onClose,
  onDone,
}: {
  dialog: RepositoryDialog;
  onClose: () => void;
  onDone: (path: string) => void;
}) {
  switch (dialog.kind) {
    case 'clone':
      return <CloneRepositoryDialog onClose={onClose} onCloned={onDone} />;
    case 'create':
      return <CreateRepositoryDialog onClose={onClose} onCreated={onDone} />;
    case 'initialize':
      return <InitializeRepositoryDialog onClose={onClose} onInitialized={onDone} />;
    case 'add':
      return <AddRepositoryDialog added={dialog.added} onClose={onClose} onAdded={onDone} />;
  }
}

/** GitHub Desktop's "Let's get started": clone, create, initialize, or add a repository already on the device. */
function GitStart({ onOpen }: { onOpen: (path: string) => void }) {
  const repos = useRepositories();
  const account = useGitHubAccount();
  const [dialog, setDialog] = useState<RepositoryDialog | null>(null);
  return (
    <div className={styles.screen}>
      <TopBar title="Git" subtitle="NO REPOSITORY" label="Search commands · Git" />
      <div className={styles.scroll}>
        <p className={cx('body', styles.intro)}>
          <span className="label accent">// Let&apos;s get started</span>
          Git works on one repository at a time: the project the editor has open. Pick one to start.
        </p>
        <div className={styles.actions}>
          <ActionCard
            icon={<BranchIcon size={22} />}
            title="Clone a repository"
            detail={account ? `From GitHub · @${account.login}` : 'From GitHub · Sign in first'}
            onClick={() => setDialog({ kind: 'clone' })}
          />
          <ActionCard
            icon={<PlusIcon size={22} />}
            title="Create a new repository"
            detail="A new folder, wherever you choose"
            onClick={() => setDialog({ kind: 'create' })}
          />
          <ActionCard
            icon={<ProjectIcon size={22} />}
            title="Initialize a repository"
            detail="git init in a folder you already have"
            onClick={() => setDialog({ kind: 'initialize' })}
          />
          <ActionCard
            icon={<FolderIcon size={22} />}
            title="Add an existing repository"
            detail="A folder of ~/projects with git"
            onClick={() => setDialog({ kind: 'add', added: repos ?? [] })}
          />
        </div>
        <h2 className={cx('label', 'muted', styles.heading)}>
          <span className="accent">//</span> Your repositories
        </h2>
        <RepositoryList repos={repos} activePath={null} onOpen={onOpen} />
      </div>
      {dialog && (
        <RepositoryDialogs
          dialog={dialog}
          onClose={() => setDialog(null)}
          onDone={(path) => {
            setDialog(null);
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

/**
 * GitHub Desktop's "Create a new repository": a new folder, named and put
 * wherever in ~/projects the user chooses, with git in it. It becomes one of
 * the repositories and the active project.
 */
function CreateRepositoryDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (path: string) => void }) {
  const { projectSpace, git, repositories } = useServices();
  const showSnackbar = useSnackbar();
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [choosing, setChoosing] = useState(false);
  // the name is focused once: coming back from the location, the keyboard stays down
  const [chose, setChose] = useState(false);
  const [busy, setBusy] = useState(false);
  const listing = useDirectoryListing(projectSpace, location);
  const taken = new Set(listing?.ok ? listing.entries.map((entry) => entry.name) : []);
  const error = nameError(name, taken, location);
  const valid = name.trim() !== '' && error === null && listing?.ok === true;

  const create = async () => {
    const path = joinPath(location, name.trim());
    setBusy(true);
    try {
      await projectSpace.createDirectory(path);
      await git.init(path);
      await repositories.add(path);
      onCreated(path);
    } catch (failure) {
      showSnackbar(`Error: ${errorMessage(failure)}`);
      setBusy(false);
    }
  };

  if (choosing) {
    return (
      <LocationDialog
        start={location}
        onClose={() => setChoosing(false)}
        onChoose={(path) => {
          setLocation(path);
          setChoosing(false);
        }}
      />
    );
  }

  return (
    <Dialog
      title="New repository"
      eyebrow="NEW FOLDER · GIT INIT"
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
            onClick={() => void create()}
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
        autoFocus={!chose}
        onSubmit={() => valid && !busy && void create()}
      />
      <div className={styles.location}>
        <FolderIcon size={20} />
        <span className={styles.actionText}>
          <span className="caption muted">LOCATION</span>
          <span className="body ellipsis">{shown(location)}</span>
        </span>
        <Button
          variant="text"
          disabled={busy}
          onClick={() => {
            setChose(true);
            setChoosing(true);
          }}
        >
          Change
        </Button>
      </div>
    </Dialog>
  );
}

/**
 * GitHub Desktop's "Initialize": a folder of ~/projects without git, at any
 * depth, gets it. It becomes one of the repositories and the active project.
 */
function InitializeRepositoryDialog({
  onClose,
  onInitialized,
}: {
  onClose: () => void;
  onInitialized: (path: string) => void;
}) {
  const { projectSpace, git, repositories } = useServices();
  const showSnackbar = useSnackbar();
  const [busy, setBusy] = useState(false);
  const folders = useFolderStack('');
  const listing = useDirectoryListing(projectSpace, folders.path, 0, true);
  const here = folders.path;
  const isRepo = listing?.ok === true && hasGitDir(listing.entries);
  const ready = here !== '' && listing?.ok === true && !isRepo;
  const status =
    here === ''
      ? 'Open the folder to turn into a repository.'
      : listing === null
        ? ''
        : isRepo
          ? 'Already a git repository: add it instead.'
          : `git init in ${basename(here)}, on main.`;

  const initialize = async () => {
    setBusy(true);
    try {
      await git.init(here);
      await repositories.add(here);
      onInitialized(here);
    } catch (failure) {
      showSnackbar(`Error: ${errorMessage(failure)}`);
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Initialize repository"
      eyebrow="GIT INIT IN ~/projects"
      onClose={onClose}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="filled"
            className={cx(busy && 'cursor')}
            disabled={!ready || busy}
            onClick={() => void initialize()}
          >
            {busy ? 'Initializing' : 'Initialize'}
          </Button>
        </>
      }
    >
      <FolderPicker
        folders={folders}
        listing={listing}
        rootLabel="~/projects"
        hide={isGitDir}
        mark={(folder) => <GitMark listing={listing} folder={folder} />}
      />
      <p className={cx('caption', ready ? 'accent' : 'muted', styles.pickStatus)}>{status}</p>
    </Dialog>
  );
}

/**
 * GitHub Desktop's "Add an existing repository": walk ~/projects to a folder
 * with git, at any depth. Repositories already added are marked and can't be
 * added again.
 */
function AddRepositoryDialog({
  added,
  onClose,
  onAdded,
}: {
  added: readonly ProjectInfo[];
  onClose: () => void;
  onAdded: (path: string) => void;
}) {
  const { projectSpace, repositories } = useServices();
  const showSnackbar = useSnackbar();
  const [busy, setBusy] = useState(false);
  const folders = useFolderStack('');
  const listing = useDirectoryListing(projectSpace, folders.path, 0, true);
  const addedPaths = new Set(added.map((repo) => repo.path));
  const here = folders.path;
  const isRepo = listing?.ok === true && hasGitDir(listing.entries);
  const already = addedPaths.has(here);
  const status =
    here === ''
      ? 'Open the repository’s folder.'
      : listing === null
        ? ''
        : already
          ? 'Already in your repositories.'
          : isRepo
            ? `${basename(here)} is a git repository.`
            : 'Not a git repository: it has no .git folder.';

  const add = async () => {
    setBusy(true);
    try {
      await repositories.add(here);
      onAdded(here);
    } catch (failure) {
      showSnackbar(`Error: ${errorMessage(failure)}`);
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Add repository"
      eyebrow="FROM ~/projects"
      onClose={onClose}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="filled"
            className={cx(busy && 'cursor')}
            disabled={!isRepo || already || busy}
            onClick={() => void add()}
          >
            {busy ? 'Adding' : 'Add'}
          </Button>
        </>
      }
    >
      <FolderPicker
        folders={folders}
        listing={listing}
        rootLabel="~/projects"
        hide={isGitDir}
        mark={(folder) =>
          addedPaths.has(folder.path) ? (
            <span className={cx('caption', styles.mark)}>ADDED</span>
          ) : (
            <GitMark listing={listing} folder={folder} />
          )
        }
      />
      <p className={cx('caption', isRepo && !already ? 'accent' : 'muted', styles.pickStatus)}>{status}</p>
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
    return (
      <p className={cx('caption', 'muted', styles.note)}>None yet: add one already on the device, or create one.</p>
    );
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
  const { git, repositories } = useServices();
  const showSnackbar = useSnackbar();
  const [choosing, setChoosing] = useState(false);
  // creating, initializing or adding another repository
  const [more, setMore] = useState<RepositoryDialog | null>(null);
  const [branching, setBranching] = useState(false);
  const [tab, setTab] = useState<'changes' | 'history'>('changes');
  const [initializing, setInitializing] = useState(false);
  const [tick, setTick] = useState(0);
  // undefined while reading; null when the project is not a repository
  const [repo, setRepo] = useState<RepoInfo | null | undefined>(undefined);
  // `.git` appearing or going away changes the answer
  useFolderChanges(project.path, () => setTick((value) => value + 1));
  // The repository on show is always one of yours (initialized here, or older than the list)
  useEffect(() => {
    if (repo) repositories.add(project.path).catch((error: unknown) => console.error('Cannot add repository', error));
  }, [repositories, project.path, repo]);
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
      {/* GitHub Desktop's toolbar: the repository, and the branch it is on */}
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.current}
          aria-label={`Current repository: ${project.name}`}
          onClick={() => setChoosing(true)}
        >
          <ProjectIcon size={20} />
          <span className={styles.actionText}>
            <span className="caption muted">REPOSITORY</span>
            <span className={cx('body', 'ellipsis', styles.repoName)}>{project.name}</span>
          </span>
          <span className="muted" aria-hidden>
            ▾
          </span>
        </button>
        {repo && (
          <button
            type="button"
            className={styles.current}
            aria-label={`Current branch: ${repo.branch}`}
            onClick={() => setBranching(true)}
          >
            <BranchIcon size={20} />
            <span className={styles.actionText}>
              <span className="caption muted">BRANCH</span>
              <span className={cx('body', 'ellipsis', styles.repoName)}>{repo.branch}</span>
            </span>
            <span className="muted" aria-hidden>
              ▾
            </span>
          </button>
        )}
      </div>
      {repo === undefined ? (
        <span hidden data-loading />
      ) : repo ? (
        <>
          <div className={styles.tabs} role="tablist" aria-label="Repository">
            {(['changes', 'history'] as const).map((name) => (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={tab === name}
                className={cx('label', styles.tab)}
                onClick={() => setTab(name)}
              >
                {name === 'changes' ? 'Changes' : 'History'}
              </button>
            ))}
          </div>
          {/* Changes stays while History shows: the message and the picked lines are kept */}
          <div className={styles.tabPanel} role="tabpanel" hidden={tab !== 'changes'}>
            <ChangesView
              key={repo.branch}
              path={project.path}
              branch={repo.branch}
              visible={tab === 'changes'}
              onCommitted={() => setTick((value) => value + 1)}
            />
          </div>
          {tab === 'history' && (
            <div className={styles.tabPanel} role="tabpanel">
              <HistoryView key={repo.branch} path={project.path} />
            </div>
          )}
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
      {branching && repo && (
        <BranchesDialog
          path={project.path}
          repo={repo}
          onClose={() => setBranching(false)}
          onSwitched={(info) => {
            setBranching(false);
            setRepo(info);
          }}
        />
      )}
      {choosing && (
        <ChooseRepository
          activePath={project.path}
          onClose={() => setChoosing(false)}
          onOpen={(path) => {
            setChoosing(false);
            if (path !== project.path) onOpen(path);
          }}
          onMore={(dialog) => {
            setChoosing(false);
            setMore(dialog);
          }}
        />
      )}
      {more && (
        <RepositoryDialogs
          dialog={more}
          onClose={() => setMore(null)}
          onDone={(path) => {
            setMore(null);
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
  onMore,
}: {
  activePath: string;
  onClose: () => void;
  onOpen: (path: string) => void;
  /** Create, initialize or add another one, like GitHub Desktop's "Add" menu. */
  onMore: (dialog: RepositoryDialog) => void;
}) {
  const repos = useRepositories();
  const more: [string, ReactNode, RepositoryDialog][] = [
    ['Clone a repository', <BranchIcon key="icon" size={20} />, { kind: 'clone' }],
    ['Create a new repository', <PlusIcon key="icon" size={20} />, { kind: 'create' }],
    ['Initialize a repository', <ProjectIcon key="icon" size={20} />, { kind: 'initialize' }],
    ['Add an existing repository', <FolderIcon key="icon" size={20} />, { kind: 'add', added: repos ?? [] }],
  ];
  return (
    <Dialog title="Your repositories" eyebrow="SWITCH THE ACTIVE PROJECT" onClose={onClose}>
      <RepositoryList repos={repos} activePath={activePath} onOpen={onOpen} />
      <div className={styles.more}>
        {more.map(([label, icon, dialog]) => (
          <Button
            key={label}
            variant="text"
            listItem
            className={cx('body', styles.moreItem)}
            disabled={repos === null}
            onClick={() => onMore(dialog)}
          >
            {icon}
            <span className="ellipsis">{label}</span>
          </Button>
        ))}
      </div>
    </Dialog>
  );
}
