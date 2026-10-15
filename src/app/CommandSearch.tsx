import { type ReactNode, useId, useState } from 'react';
import type { Command } from '../core/commands';
import { errorMessage } from '../features/projects/errors';
import { useBackHandler } from '../ui/back';
import { cx } from '../ui/cx';
import { useSnackbar } from '../ui/useSnackbar';
import styles from './CommandSearch.module.css';
import { matchCommands } from './matchCommands';
import { useServices } from './services';

/**
 * Command search living in a screen header (VS Code's "command center").
 * Idle, it shows [children] (e.g. the open file) in a search-styled box;
 * tapped, it becomes an input with matching commands dropping down below
 * the header. Enter runs the highlighted one; back, Escape or a tap outside closes.
 */
export function CommandSearch({
  children,
  label = 'Search commands',
  prefer,
}: {
  children: ReactNode;
  label?: string;
  /** Id prefix of the screen's own commands (e.g. `editor.`), listed first. */
  prefer?: string;
}) {
  const { registry, dispatcher } = useServices();
  const showSnackbar = useSnackbar();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const listId = useId();

  const close = () => {
    setOpen(false);
    setQuery('');
    setHighlighted(0);
  };
  useBackHandler(open, close);

  const results = open ? matchCommands(registry.all, query, prefer) : [];
  const current = Math.min(highlighted, Math.max(results.length - 1, 0));

  const run = (command: Command | undefined) => {
    if (!command) return;
    close();
    dispatcher.execute(command.id).catch((error: unknown) => showSnackbar(`Error: ${errorMessage(error)}`));
  };

  if (!open) {
    return (
      <button type="button" className={styles.box} aria-label={label} onClick={() => setOpen(true)}>
        <span className={cx('body', styles.prompt)} aria-hidden>
          &gt;
        </span>
        <span className={styles.idle}>{children}</span>
      </button>
    );
  }

  return (
    <>
      <div className={cx(styles.box, styles.active)}>
        <span className={cx('body', styles.prompt)} aria-hidden>
          &gt;
        </span>
        <input
          className={cx('body', styles.input)}
          value={query}
          placeholder="Search commands"
          aria-label={label}
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={results.length ? `${listId}-${current}` : undefined}
          autoFocus
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlighted(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              run(results[current]);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              close();
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const step = event.key === 'ArrowDown' ? 1 : -1;
              setHighlighted((current + step + results.length) % Math.max(results.length, 1));
            }
          }}
        />
      </div>
      <div className={styles.backdrop} onClick={close} aria-hidden />
      <ul id={listId} role="listbox" className={styles.results} aria-label="Commands">
        {results.map((command, index) => (
          <li
            key={command.id}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === current}
            className={cx(styles.option, index === current && styles.optionActive)}
            // Keep the input focused (and the keyboard up) until the command runs.
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => run(command)}
          >
            <span className="accent" aria-hidden>
              ›
            </span>
            <span className={cx('body', 'ellipsis', styles.title)}>{command.title}</span>
            <span className="caption muted ellipsis">{command.id}</span>
          </li>
        ))}
        {results.length === 0 && <li className={cx('label', 'muted', styles.empty)}>No matching commands</li>}
      </ul>
    </>
  );
}
