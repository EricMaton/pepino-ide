import { useEffect, useReducer, useState } from 'react';
import { useServices } from '../../app/services';
import { TextField } from '../../ui/components';
import { cx } from '../../ui/cx';
import {
  ACCENTS,
  BASE_COLORS,
  type ContributedTheme,
  isHexColor,
  type ThemeBase,
  type ThemeChoice,
} from '../../ui/theme';
import styles from './SettingsScreen.module.css';

/** The theme chosen and the plugins' themes, kept in step with the store. */
function useThemes(): { choice: ThemeChoice; contributed: readonly ContributedTheme[] | null } {
  const { theme } = useServices();
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  useEffect(() => theme.subscribe(refresh), [theme]);
  return { choice: theme.choice(), contributed: theme.contributed() };
}

const MODES: [Exclude<ThemeChoice['mode'], 'plugin'>, string, string][] = [
  ['dark', 'Dark', 'Pepino on black'],
  ['light', 'Light', 'On paper'],
  ['system', 'System', "The phone's own"],
  ['custom', 'Custom', 'Your accent'],
];

/** Appearance (#44): the theme, for a custom one its base and accent, and the themes plugins bring (#52). */
export function Appearance() {
  const { theme } = useServices();
  const { choice, contributed } = useThemes();
  const pluginThemeGone =
    choice.mode === 'plugin' && contributed !== null && !contributed.some((plugged) => plugged.id === choice.id);
  // A custom theme keeps its base and accent while another mode is tried
  const [custom, setCustom] = useState<{ base: ThemeBase; accent: string }>(() =>
    choice.mode === 'custom'
      ? { base: choice.base, accent: choice.accent }
      : { base: 'dark', accent: ACCENTS[3].color },
  );
  const [hex, setHex] = useState(custom.accent.slice(1));

  const choose = (next: ThemeChoice) => void theme.set(next);
  const setCustomTheme = (next: { base: ThemeBase; accent: string }) => {
    setCustom(next);
    setHex(next.accent.slice(1));
    choose({ mode: 'custom', ...next });
  };

  return (
    <section className={styles.card} aria-label="Theme">
      <div className={styles.options} role="radiogroup" aria-label="Theme">
        {MODES.map(([mode, label, detail]) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={choice.mode === mode}
            className={cx(styles.option, choice.mode === mode && styles.optionChosen)}
            onClick={() => (mode === 'custom' ? choose({ mode: 'custom', ...custom }) : choose({ mode }))}
          >
            <span className="body">{label}</span>
            <span className="caption muted">{detail}</span>
          </button>
        ))}
      </div>
      {contributed !== null && contributed.length > 0 && (
        <div className={styles.options} role="radiogroup" aria-label="Themes from plugins">
          {contributed.map((plugged) => {
            const chosen = choice.mode === 'plugin' && choice.id === plugged.id;
            const own = BASE_COLORS[plugged.base];
            return (
              <button
                key={plugged.id}
                type="button"
                role="radio"
                aria-checked={chosen}
                className={cx(styles.option, chosen && styles.optionChosen)}
                onClick={() => choose({ mode: 'plugin', id: plugged.id, base: plugged.base, colors: plugged.colors })}
              >
                <span className={styles.themePreview} aria-hidden="true">
                  {[
                    plugged.colors.bg ?? own.bg,
                    plugged.colors.fg ?? own.fg,
                    plugged.colors.primary ?? own.primary,
                  ].map((color, i) => (
                    <span key={i} style={{ background: color }} />
                  ))}
                </span>
                <span className="body">{plugged.label}</span>
                <span className="caption muted">{plugged.plugin}</span>
              </button>
            );
          })}
        </div>
      )}
      {pluginThemeGone && choice.mode === 'plugin' && (
        <p className={cx('caption muted', styles.cardNote)}>
          The plugin of the theme you chose is off: its {choice.base} base shows until it is back.
        </p>
      )}
      {choice.mode === 'custom' && (
        <>
          <div className={styles.options} role="radiogroup" aria-label="Base">
            {(['dark', 'light'] as const).map((base) => (
              <button
                key={base}
                type="button"
                role="radio"
                aria-checked={custom.base === base}
                className={cx(styles.option, styles.optionSmall, custom.base === base && styles.optionChosen)}
                onClick={() => setCustomTheme({ ...custom, base })}
              >
                <span className="body">{base === 'dark' ? 'Dark base' : 'Light base'}</span>
              </button>
            ))}
          </div>
          <div className={styles.swatches} role="radiogroup" aria-label="Accent">
            {ACCENTS.map(({ name, color }) => (
              <button
                key={color}
                type="button"
                role="radio"
                aria-checked={custom.accent === color}
                aria-label={name}
                title={name}
                className={cx(styles.swatch, custom.accent === color && styles.swatchChosen)}
                style={{ background: color }}
                onClick={() => setCustomTheme({ ...custom, accent: color })}
              />
            ))}
          </div>
          <TextField
            label="Accent (#rrggbb)"
            value={hex}
            prefix="#"
            placeholder="2f7cf6"
            error={hex.trim() && !isHexColor(hex.startsWith('#') ? hex : `#${hex}`) ? 'Six hex digits' : null}
            onChange={(value) => {
              const text = value.replace(/^#/, '');
              setHex(text);
              const color = `#${text.trim().toLowerCase()}`;
              if (isHexColor(color)) setCustomTheme({ ...custom, accent: color });
            }}
          />
        </>
      )}
    </section>
  );
}
