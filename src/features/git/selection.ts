import { changedLines, type FileDiff, type LineExclusion } from './diff';

/**
 * What of a changed file goes into the next commit, like GitHub Desktop: all
 * of it (ticked), none (unticked), or all but some of its changed lines.
 */
export type Selection = 'all' | 'none' | LineExclusion;

/** The changed lines of [diff] left out under [selection]. A selection made on another version leaves out none. */
export function excludedLines(diff: FileDiff, selection: Selection): ReadonlySet<number> {
  if (selection === 'all') return new Set();
  if (selection === 'none') return new Set(changedLines(diff).map((line) => line.index!));
  return new Set(selection.version === diff.version ? selection.lines : []);
}

/** The selection that leaves out [excluded]: all and none when it is every line or no line. */
export function selectionOf(diff: FileDiff, excluded: ReadonlySet<number>): Selection {
  const total = changedLines(diff).length;
  if (excluded.size === 0) return 'all';
  if (excluded.size >= total) return 'none';
  return { version: diff.version, lines: [...excluded].sort((a, b) => a - b) };
}

/**
 * Taps on [lines] (one line, or a hunk's): when every one of them is in the
 * commit they all leave it, otherwise they all go in.
 */
export function toggleLines(diff: FileDiff, selection: Selection, lines: readonly number[]): Selection {
  const excluded = new Set(excludedLines(diff, selection));
  const allIn = lines.every((line) => !excluded.has(line));
  for (const line of lines) {
    if (allIn) excluded.add(line);
    else excluded.delete(line);
  }
  return selectionOf(diff, excluded);
}
