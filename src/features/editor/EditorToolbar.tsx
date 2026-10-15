import { cx } from '../../ui/cx';
import styles from './EditorScreen.module.css';
import type { ToolbarKey } from './toolbar';

/**
 * Symbol/edit keys under the editor. Keys never take focus (pointerdown is
 * cancelled), so the system keyboard stays open while tapping them.
 */
export function EditorToolbar({ keys, onRun }: { keys: readonly ToolbarKey[]; onRun: (id: string) => void }) {
  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Editor keys">
      {keys.map((key) => (
        <button
          key={key.id}
          type="button"
          className={cx('body', styles.key, key.label.length > 2 && styles.wideKey)}
          aria-label={key.title}
          title={key.title}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => onRun(key.id)}
        >
          {key.label}
        </button>
      ))}
    </div>
  );
}
