import { type ReactNode, useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import { TopBar } from '../../app/TopBar';
import { Dialog } from '../../ui/components';
import { cx } from '../../ui/cx';
import { BranchIcon, PlusIcon } from '../../ui/icons';
import { findRepositories, isRepository, type ProjectInfo } from '../projects/projects';
import { useFolderChanges } from '../projects/useFolderChanges';
import styles from './GitScreen.module.css';

/*
 * GIT works like GitHub Desktop on the one active project, which the editor
 * shares: choosing a repository here makes it the active project everywhere.
 * Cloning (#29, #31, #32) and creating repositories (#22) show already, and
 * turn on when the git engine (ADR-006) lands.
 */
interface GitScreenProps {
  project: ProjectInfo | null;
  /** Makes [path] the active project. */
  onOpen: (path: string) => void;
  /** The git screens still to come, shown for a project that is a repository. */
  teaser: ReactNode;
}

export function GitScreen({ project, onOpen, teaser }: GitScreenProps) {
  return project ? (
    <GitProject key={project.path} project={project} onOpen={onOpen} teaser={teaser} />
  ) : (
    <GitStart onOpen={onOpen} />
  );
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
  return (
    <div className={styles.screen}>
      <TopBar title="Git" subtitle="NO REPOSITORY" label="Search commands · Git" />
      <div className={styles.scroll}>
        <p className={cx('body', styles.intro)}>
          <span className="label accent">// Let&apos;s get started</span>
          Git works on one repository at a time: the project the editor has open. Pick one to start.
        </p>
        <div className={styles.actions}>
          <SoonAction icon={<BranchIcon size={22} />} title="Clone a repository" detail="From GitHub · Sign in first" />
          <SoonAction
            icon={<PlusIcon size={22} />}
            title="Create a new repository"
            detail="In a folder of ~/projects"
          />
        </div>
        <h2 className={cx('label', 'muted', styles.heading)}>
          <span className="accent">//</span> Add an existing repository
        </h2>
        <RepositoryList repos={repos} activePath={null} onOpen={onOpen} />
      </div>
    </div>
  );
}

function SoonAction({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <button type="button" className={styles.action} disabled>
      <span className={styles.actionIcon} aria-hidden>
        {icon}
      </span>
      <span className={styles.actionText}>
        <span className="body">{title}</span>
        <span className="caption muted">{detail}</span>
      </span>
      <span className={cx('caption', styles.soon)}>SOON</span>
    </button>
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
function GitProject({
  project,
  onOpen,
  teaser,
}: {
  project: ProjectInfo;
  onOpen: (path: string) => void;
  teaser: ReactNode;
}) {
  const { projectSpace } = useServices();
  const [choosing, setChoosing] = useState(false);
  const [tick, setTick] = useState(0);
  const [repo, setRepo] = useState<boolean | null>(null);
  useFolderChanges(project.path, () => setTick((value) => value + 1));
  useEffect(() => {
    let active = true;
    void isRepository(projectSpace, project.path).then((found) => active && setRepo(found));
    return () => {
      active = false;
    };
  }, [projectSpace, project.path, tick]);

  return (
    <div className={styles.screen}>
      <TopBar
        title="Git"
        subtitle={`${project.name} · ${repo === false ? 'NOT A REPOSITORY' : 'REPOSITORY'}`}
        label="Search commands · Git"
      />
      <button type="button" className={styles.current} onClick={() => setChoosing(true)}>
        <BranchIcon size={20} />
        <span className={styles.actionText}>
          <span className="caption muted">CURRENT REPOSITORY</span>
          <span className={cx('body', 'ellipsis', styles.repoName)}>{project.name}</span>
        </span>
        <span className="muted" aria-hidden>
          ▾
        </span>
      </button>
      {repo === null ? null : repo ? (
        teaser
      ) : (
        <div className={styles.notRepo}>
          <span className="label accent">// No git yet</span>
          <p className="title">This folder is not a git repository</p>
          <p className="caption muted">
            Initialize one to track changes in <strong>{project.name}</strong>. Nothing changes until you ask.
          </p>
          <SoonAction
            icon={<PlusIcon size={22} />}
            title="Initialize repository"
            detail={`git init in ${project.name}`}
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
