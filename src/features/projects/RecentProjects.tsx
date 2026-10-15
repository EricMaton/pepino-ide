import { useEffect, useState } from 'react';
import { cx } from '../../ui/cx';
import { PepinoMark } from '../../ui/Logo';
import styles from './FileExplorer.module.css';
import { formatAgo, type RecentProject, type RecentProjects as RecentStore } from './recents';

/** Horizontal strip of the last opened projects; hidden until there is at least one. */
export function RecentProjects({ store, onOpen }: { store: RecentStore; onOpen: (path: string) => void }) {
  // "5M AGO" is relative to when the list was loaded, which keeps rendering pure.
  const [loaded, setLoaded] = useState<{ recents: RecentProject[]; at: number } | null>(null);

  useEffect(() => {
    let active = true;
    store.load().then(
      (recents) => {
        if (active) setLoaded({ recents, at: Date.now() });
      },
      (error: unknown) => console.error('Cannot load recent projects', error),
    );
    return () => {
      active = false;
    };
  }, [store]);

  if (!loaded?.recents.length) return null;

  return (
    <section className={styles.recents} aria-label="Recent projects">
      <h2 className="label muted">
        <span className="accent">//</span> Recent
      </h2>
      <div className={styles.recentStrip}>
        {loaded.recents.map((project) => (
          <button key={project.path} type="button" className={styles.recentCard} onClick={() => onOpen(project.path)}>
            <PepinoMark size={28} />
            <span className={cx('body', 'ellipsis', styles.recentName)}>{project.name}</span>
            <span className="caption muted">{formatAgo(project.openedMillis, loaded.at)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
