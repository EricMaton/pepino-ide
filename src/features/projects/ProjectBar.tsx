import { Button } from '../../ui/components';
import { CloseIcon } from '../../ui/icons';
import { PepinoMark } from '../../ui/Logo';
import styles from './FileExplorer.module.css';
import type { ProjectInfo } from './projects';

/** Shows which project is open and closes it. */
export function ProjectBar({ project, onClose }: { project: ProjectInfo; onClose: () => void }) {
  return (
    <div className={styles.projectBar}>
      <PepinoMark size={32} />
      <div className={styles.projectBarText}>
        <span className="caption muted">PROJECT</span>
        <h2 className="title ellipsis">{project.name}</h2>
      </div>
      <Button variant="text" square aria-label="Close project" onClick={onClose}>
        <CloseIcon />
      </Button>
    </div>
  );
}
