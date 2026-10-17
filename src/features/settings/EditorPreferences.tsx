import { useServices } from '../../app/services';
import { Button } from '../../ui/components';
import { cx } from '../../ui/cx';
import { type EditorSettings, TAB_SIZES } from '../editor/editorSettings';
import { useEditorSettings } from '../editor/useEditorSettings';
import { MAX_FONT_SIZE, MIN_FONT_SIZE, ZOOM_STEP } from '../editor/zoom';
import styles from './SettingsScreen.module.css';

/** Editor (#45): font size, tabs, word wrap and line numbers; open editors follow at once. */
export function EditorPreferences() {
  const { editorSettings } = useServices();
  const settings = useEditorSettings();
  const change = (next: Partial<EditorSettings>) => void editorSettings.set(next).catch(() => undefined);

  return (
    <section className={styles.card} aria-label="Editor">
      <div className={styles.row}>
        <span className={styles.rowText}>
          <span className="body">Font size</span>
          <span className="caption muted">Pinching a file changes it too</span>
        </span>
        <div className={styles.stepper}>
          <Button
            variant="outlined"
            square
            aria-label="Smaller"
            disabled={settings.fontSize <= MIN_FONT_SIZE}
            onClick={() => change({ fontSize: settings.fontSize - ZOOM_STEP })}
          >
            −
          </Button>
          <span className={cx('body', styles.stepperValue)} aria-live="polite">
            {settings.fontSize}
          </span>
          <Button
            variant="outlined"
            square
            aria-label="Bigger"
            disabled={settings.fontSize >= MAX_FONT_SIZE}
            onClick={() => change({ fontSize: settings.fontSize + ZOOM_STEP })}
          >
            +
          </Button>
        </div>
      </div>
      <p className={styles.sample} style={{ fontSize: `${settings.fontSize}px` }} aria-hidden>
        {'function hello() {'}
        <br />
        {settings.insertSpaces ? ' '.repeat(settings.tabSize) : '→'.padEnd(settings.tabSize, ' ')}
        {"return 'pepino';"}
        <br />
        {'}'}
      </p>

      <span className="label muted">Tab size</span>
      <div className={cx(styles.options, styles.optionsThree)} role="radiogroup" aria-label="Tab size">
        {TAB_SIZES.map((size) => (
          <button
            key={size}
            type="button"
            role="radio"
            aria-checked={settings.tabSize === size}
            className={cx(styles.option, styles.optionSmall, settings.tabSize === size && styles.optionChosen)}
            onClick={() => change({ tabSize: size })}
          >
            <span className="body">{size}</span>
          </button>
        ))}
      </div>

      <span className="label muted">Tab inserts</span>
      <div className={styles.options} role="radiogroup" aria-label="Tab inserts">
        {([true, false] as const).map((spaces) => (
          <button
            key={String(spaces)}
            type="button"
            role="radio"
            aria-checked={settings.insertSpaces === spaces}
            className={cx(styles.option, styles.optionSmall, settings.insertSpaces === spaces && styles.optionChosen)}
            onClick={() => change({ insertSpaces: spaces })}
          >
            <span className="body">{spaces ? 'Spaces' : 'A tab'}</span>
          </button>
        ))}
      </div>

      <Toggle
        label="Word wrap"
        detail="Long lines wrap instead of scrolling sideways"
        on={settings.wordWrap}
        onChange={(wordWrap) => change({ wordWrap })}
      />
      <Toggle
        label="Line numbers"
        detail="The gutter on the left"
        on={settings.lineNumbers}
        onChange={(lineNumbers) => change({ lineNumbers })}
      />
    </section>
  );
}

function Toggle({
  label,
  detail,
  on,
  onChange,
}: {
  label: string;
  detail: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button type="button" role="switch" aria-checked={on} className={styles.toggle} onClick={() => onChange(!on)}>
      <span className={styles.rowText}>
        <span className="body">{label}</span>
        <span className="caption muted">{detail}</span>
      </span>
      <span className={cx('label', styles.switch, on && styles.switchOn)} aria-hidden>
        {on ? 'ON' : 'OFF'}
      </span>
    </button>
  );
}
