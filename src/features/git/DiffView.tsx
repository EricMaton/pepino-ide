import { useVirtualizer } from '@tanstack/react-virtual';
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { useServices } from '../../app/services';
import { useBackHandler } from '../../ui/back';
import { Button } from '../../ui/components';
import { cx } from '../../ui/cx';
import { BackIcon } from '../../ui/icons';
import { useSnackbar } from '../../ui/useSnackbar';
import { clampFontSize, DEFAULT_FONT_SIZE, FONT_SIZE_KEY } from '../editor/zoom';
import { errorMessage } from '../projects/errors';
import { basename, joinPath } from '../projects/paths';
import { changedLines, type DiffLine, type FileDiff, type Hunk } from './diff';
import styles from './GitScreen.module.css';
import { excludedLines, type Selection, toggleLines } from './selection';

/** A file written in a burst (autosave) is diffed again once. */
const DIFF_DEBOUNCE_MS = 400;

type Row = { kind: 'hunk'; hunk: Hunk; lines: number[] } | { kind: 'line'; line: DiffLine };

/** [file]'s diff, read again whenever it changes on disk. Null while the first read runs. */
function useDiff(path: string, file: string): { diff: FileDiff | null; error: string | null } {
  const { git, events } = useServices();
  const [tick, setTick] = useState(0);
  const [result, setResult] = useState<{ diff: FileDiff | null; error: string | null }>({ diff: null, error: null });

  useEffect(() => {
    const target = joinPath(path, file);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const touched = (changed: string) => {
      if (changed !== target) return;
      clearTimeout(timer);
      timer = setTimeout(() => setTick((value) => value + 1), DIFF_DEBOUNCE_MS);
    };
    const disposers = [
      events.subscribe('fs.created', ({ path: changed }) => touched(changed)),
      events.subscribe('fs.written', ({ path: changed }) => touched(changed)),
      events.subscribe('fs.deleted', ({ path: changed }) => touched(changed)),
      events.subscribe('fs.moved', ({ from, to }) => {
        touched(from);
        touched(to);
      }),
    ];
    return () => {
      clearTimeout(timer);
      disposers.forEach((dispose) => dispose());
    };
  }, [events, path, file]);

  useEffect(() => {
    let active = true;
    git.diff(path, file).then(
      (diff) => active && setResult({ diff, error: null }),
      (error: unknown) => active && setResult((current) => ({ diff: current.diff, error: errorMessage(error) })),
    );
    return () => {
      active = false;
    };
  }, [git, path, file, tick]);

  return result;
}

/** The editor's font size (pinch or Zoom there): diffs read at the size the user reads code at. */
function useCodeFontSize(): number {
  const { preferences } = useServices();
  const [size, setSize] = useState(DEFAULT_FONT_SIZE);
  useEffect(() => {
    let active = true;
    preferences
      .get(FONT_SIZE_KEY)
      .then((saved) => active && saved !== null && setSize(clampFontSize(Number(saved))))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [preferences]);
  return size;
}

const MARKS: Record<DiffLine['kind'], string> = { added: '+', removed: '−', context: ' ' };

/**
 * One changed file, GitHub Desktop's way but for a 6" screen: a unified diff
 * (one column, lines wrapped, never side by side), where tapping a changed
 * line takes it out of the commit or puts it back, and tapping a hunk's
 * header does it for the whole hunk.
 */
export function DiffView({
  path,
  file,
  selection,
  onSelect,
  onClose,
}: {
  /** The repository (the active project). */
  path: string;
  /** Relative to the repository. */
  file: string;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onClose: () => void;
}) {
  const { diff, error } = useDiff(path, file);
  const fontSize = useCodeFontSize();
  const showSnackbar = useSnackbar();
  const scrollRef = useRef<HTMLDivElement>(null);
  useBackHandler(true, onClose);

  // Lines picked on what the file was before it changed again no longer mean the same lines.
  const version = diff?.version;
  useEffect(() => {
    if (version !== undefined && typeof selection === 'object' && selection.version !== version) {
      onSelect('all');
      showSnackbar(`${basename(file)} changed: all its lines are in the commit again`);
    }
  }, [version, selection, onSelect, showSnackbar, file]);

  const rows = useMemo<Row[]>(
    () =>
      (diff?.hunks ?? []).flatMap((hunk): Row[] => [
        { kind: 'hunk', hunk, lines: hunk.lines.flatMap((line) => (line.index === null ? [] : [line.index])) },
        ...hunk.lines.map((line): Row => ({ kind: 'line', line })),
      ]),
    [diff],
  );
  const excluded = diff ? excludedLines(diff, selection) : new Set<number>();
  const changed = diff ? changedLines(diff) : [];
  const added = changed.filter((line) => line.kind === 'added').length;
  const lastLine = diff?.hunks.at(-1);
  const digits = String(
    Math.max(
      lastLine ? lastLine.oldStart + lastLine.oldLines : 0,
      lastLine ? lastLine.newStart + lastLine.newLines : 0,
    ),
  ).length;
  const lineHeight = Math.round(fontSize * 1.6);
  const toggle = (lines: readonly number[]) => diff && onSelect(toggleLines(diff, selection, lines));

  // eslint-disable-next-line react-hooks/incompatible-library -- the virtualizer is read during render by design
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index].kind === 'hunk' ? 40 : lineHeight),
    overscan: 20,
  });

  const lineText =
    diff && !diff.binary && !diff.tooLarge && changed.length > 0
      ? `+${added} −${changed.length - added} · committing ${changed.length - excluded.size} of ${changed.length}`
      : selection === 'none'
        ? 'Not in the commit'
        : 'In the commit';

  return (
    <div className={styles.diff}>
      <div className={styles.diffHead}>
        <Button variant="text" square aria-label="Back to the changes" onClick={onClose}>
          <BackIcon />
        </Button>
        <span className={styles.changeText}>
          <span className="body ellipsis">{basename(file)}</span>
          <span className="caption muted ellipsis">{lineText}</span>
        </span>
        <label className={styles.diffTick}>
          <input
            type="checkbox"
            className={styles.check}
            aria-label={`Commit ${file}`}
            checked={selection !== 'none'}
            ref={(input) => {
              if (input) input.indeterminate = typeof selection === 'object';
            }}
            onChange={() => onSelect(selection === 'all' ? 'none' : 'all')}
          />
        </label>
      </div>

      {diff === null ? (
        error ? (
          <p className={cx('caption', styles.note, styles.diffError)}>✕ {error}</p>
        ) : (
          <p className={cx('label', 'cursor', styles.note)} data-loading>
            Reading the diff
          </p>
        )
      ) : diff.binary || diff.tooLarge || rows.length === 0 ? (
        <div className={styles.noChanges}>
          <p className="title">
            {diff.binary ? 'Binary file' : diff.tooLarge ? 'Too large to show' : 'No changes to the text'}
          </p>
          <p className="caption muted">
            {diff.binary || diff.tooLarge
              ? 'It goes into the commit whole, or not at all: use the tick above.'
              : 'Only how the file is stored changed (its mode, or it is empty).'}
          </p>
        </div>
      ) : (
        <div
          ref={scrollRef}
          className={styles.diffScroll}
          style={
            { '--code-size': `${fontSize}px`, '--code-line': `${lineHeight}px`, '--digits': digits } as CSSProperties
          }
        >
          <div className={styles.diffRows} style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              return (
                <div
                  key={item.key}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  className={styles.diffRow}
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  {row.kind === 'hunk' ? (
                    <HunkHeader hunk={row.hunk} lines={row.lines} excluded={excluded} onToggle={toggle} />
                  ) : (
                    <LineRow line={row.line} excluded={excluded} onToggle={toggle} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function HunkHeader({
  hunk,
  lines,
  excluded,
  onToggle,
}: {
  hunk: Hunk;
  lines: number[];
  excluded: ReadonlySet<number>;
  onToggle: (lines: readonly number[]) => void;
}) {
  const out = lines.filter((line) => excluded.has(line)).length;
  const state = out === 0 ? 'true' : out === lines.length ? 'false' : 'mixed';
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state}
      className={cx('caption', styles.hunk)}
      onClick={() => onToggle(lines)}
    >
      <span className={cx(styles.box, styles[`box-${state}`])} aria-hidden />
      <span className="ellipsis">
        @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
      </span>
    </button>
  );
}

function LineRow({
  line,
  excluded,
  onToggle,
}: {
  line: DiffLine;
  excluded: ReadonlySet<number>;
  onToggle: (lines: readonly number[]) => void;
}) {
  const content = (
    <>
      <span className={styles.lineNumber} aria-hidden>
        {line.kind === 'removed' ? line.oldLine : line.newLine}
      </span>
      <span className={styles.lineMark} aria-hidden>
        {MARKS[line.kind]}
      </span>
      <span className={styles.lineText}>
        {line.endOfFile ? <span className={cx('caption', styles.eof)}>line break at end of file</span> : line.text}
        {line.noNewline && <span className={cx('caption', styles.eof)}>no newline at end</span>}
      </span>
    </>
  );
  if (line.index === null) return <div className={cx(styles.line, styles['line-context'])}>{content}</div>;
  const index = line.index;
  const included = !excluded.has(index);
  const verb = line.kind === 'added' ? 'Added' : 'Removed';
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={included}
      aria-label={
        line.endOfFile
          ? `${verb} line break at end of file`
          : `${verb} line ${line.kind === 'removed' ? line.oldLine : line.newLine}: ${line.text}`
      }
      className={cx(styles.line, styles[`line-${line.kind}`], !included && styles.lineOut)}
      onClick={() => onToggle([index])}
    >
      {content}
    </button>
  );
}
