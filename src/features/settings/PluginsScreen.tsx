import { TopBar } from '../../app/TopBar';
import { cx } from '../../ui/cx';
import { Plugins } from './Plugins';
import styles from './SettingsScreen.module.css';

/** PLUGINS (#171): every plugin, on or off, what it may do, and its log (#49). */
export function PluginsScreen({ subtitle }: { subtitle: string }) {
  return (
    <div className={styles.screen}>
      <TopBar title="Plugins" subtitle={subtitle} label="Search commands · Plugins" />
      <div className={styles.scroll}>
        <h2 className={cx('label', 'muted', styles.heading)}>
          <span className="accent">//</span> Installed
        </h2>
        <Plugins />
        <p className={cx('caption', 'muted', styles.note, styles.footnote)}>
          Plugins run sandboxed, each on its own: they reach Pepino only through what you allow. Installing more comes
          next.
        </p>
      </div>
    </div>
  );
}
