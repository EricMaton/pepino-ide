import { type ReactNode, useEffect, useId, useState } from 'react';
import type { Command } from '../core/commands';
import { errorMessage } from '../features/projects/errors';
import { fileBadge } from '../features/projects/files';
import { basename, parentPath } from '../features/projects/paths';
import { useBackHandler } from '../ui/back';
import { cx } from '../ui/cx';
import { useSnackbar } from '../ui/useSnackbar';
import styles from './CommandSearch.module.css';
import { matchCommands } from './matchCommands';
import { useServices } from './services';

/** Files the search can offer besides commands (the workspace, #106). */
export interface FileSource {
  /** Workspace root, to show folders relative to it. */
  root: string;
  /** Shown while the query is empty (open files). */
  recent: readonly string[];
  find: (query: string) => Promise<string[]>;
  open: (path: string) => void;
}

type Option = { kind: 'file'; path: string } | { kind: 'command'; command: Command };

const MAX_FILES = 6;

/**
 * Search living in the top bar (VS Code's "command center"). Idle, it shows
 * [children] (where you are) in a search-styled box; tapped, it becomes an
 * input with matching files (when a [files] source is given) and commands
 * dropping down below the bar. Enter picks the highlighted one; back, Escape
 * or a tap outside closes.
 */
export function CommandSearch({
  children,
  label = 'Search commands',
  prefer,
  files,
}: {
  children: ReactNode;
  label?: string;
  /** Id prefix of the screen's own commands (e.g. `editor.`), listed first. */
  prefer?: string;
  files?: FileSource;
}) {
  const { registry, dispatcher } = useServices();
  const showSnackbar = useSnackbar();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const [found, setFound] = useState<{ query: string; paths: string[] }>({ query: '', paths: [] });
  const listId = useId();

  const close = () => {
    setOpen(false);
    setQuery('');
    setHighlighted(0);
  };
  useBackHandler(open, close);

  // File matches arrive asynchronously (the first search walks the project).
  const find = files?.find;
  useEffect(() => {
    if (!open || !find || !query.trim()) return;
    let active = true;
    const timer = setTimeout(() => {
      find(query).then(
        (paths) => active && setFound({ query, paths: paths.slice(0, MAX_FILES) }),
        (error: unknown) => console.error('File search failed', error),
      );
    }, 80);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [open, find, query]);

  const filePaths = !files ? [] : query.trim() ? (found.query === query ? found.paths : []) : files.recent.slice(0, 5);
  const options: Option[] = open
    ? [
        ...filePaths.map((path): Option => ({ kind: 'file', path })),
        ...matchCommands(registry.all, query, prefer).map((command): Option => ({ kind: 'command', command })),
      ]
    : [];
  const current = Math.min(highlighted, Math.max(options.length - 1, 0));
  const firstCommand = options.findIndex((option) => option.kind === 'command');

  const pick = (option: Option | undefined) => {
    if (!option) return;
    close();
    if (option.kind === 'file') files?.open(option.path);
    else dispatcher.execute(option.command.id).catch((error: unknown) => showSnackbar(`Error: ${errorMessage(error)}`));
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

  const folderOf = (path: string) => {
    const folder = parentPath(path);
    const relative = !files || files.root === '' ? folder : folder.slice(files.root.length + 1);
    return relative || '/';
  };

  return (
    <>
      <div className={cx(styles.box, styles.active)}>
        <span className={cx('body', styles.prompt)} aria-hidden>
          &gt;
        </span>
        <input
          className={cx('body', styles.input)}
          value={query}
          placeholder={files ? 'Search files and commands' : 'Search commands'}
          aria-label={label}
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={options.length ? `${listId}-${current}` : undefined}
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
              pick(options[current]);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              close();
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const step = event.key === 'ArrowDown' ? 1 : -1;
              setHighlighted((current + step + options.length) % Math.max(options.length, 1));
            }
          }}
        />
      </div>
      <div className={styles.backdrop} onClick={close} aria-hidden />
      <ul id={listId} role="listbox" className={styles.results} aria-label="Files and commands">
        {options.map((option, index) => (
          <li key={option.kind === 'file' ? `file:${option.path}` : option.command.id} role="none">
            {(index === 0 || index === firstCommand) && filePaths.length > 0 && (
              <span className={cx('caption', 'muted', styles.group)} aria-hidden>
                {option.kind === 'file' ? (query.trim() ? 'FILES' : 'OPEN FILES') : 'COMMANDS'}
              </span>
            )}
            <div
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === current}
              className={cx(styles.option, index === current && styles.optionActive)}
              // Keep the input focused (and the keyboard up) until the choice is made.
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => pick(option)}
            >
              {option.kind === 'file' ? (
                <>
                  <span className={cx('caption', styles.badge)} aria-hidden>
                    {fileBadge(basename(option.path))}
                  </span>
                  <span className={cx('body', 'ellipsis', styles.title)}>{basename(option.path)}</span>
                  <span className="caption muted ellipsis">{folderOf(option.path)}</span>
                </>
              ) : (
                <>
                  <span className="accent" aria-hidden>
                    ›
                  </span>
                  <span className={cx('body', 'ellipsis', styles.title)}>{option.command.title}</span>
                  <span className="caption muted ellipsis">{option.command.id}</span>
                </>
              )}
            </div>
          </li>
        ))}
        {options.length === 0 && <li className={cx('label', 'muted', styles.empty)}>No matches</li>}
      </ul>
    </>
  );
}
