import { cx } from '../../ui/cx';
import { ProjectIcon } from '../../ui/icons';
import styles from './FileExplorer.module.css';
import { formatAgo } from './recents';
import type { LoadedRecents } from './useRecentProjects';

/** Horizontal strip of the other recently opened projects (the active one has the bottom strip); hidden when empty. */
export function RecentProjects({
  loaded,
  activePath,
  onOpen,
}: {
  loaded: LoadedRecents | null;
  activePath: string | null;
  onOpen: (path: string) => void;
}) {
  const recents = loaded?.recents.filter((project) => project.path !== activePath) ?? [];
  if (!loaded || recents.length === 0) return null;

  return (
    <section className={styles.recents} aria-label="Recent projects">
      <h2 className="label muted">
        <span className="accent">//</span> Recent
      </h2>
      <div className={styles.recentStrip}>
        {recents.map((project) => (
          <button key={project.path} type="button" className={styles.recentCard} onClick={() => onOpen(project.path)}>
            <span className={styles.recentIcon} aria-hidden>
              <ProjectIcon size={22} />
            </span>
            <span className={cx('body', 'ellipsis', styles.recentName)}>{project.name}</span>
            <span className="caption muted">{formatAgo(project.openedMillis, loaded.at)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
