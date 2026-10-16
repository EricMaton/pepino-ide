/*
 * Diffs of one file against the last commit, as hunks of lines: what the diff
 * viewer shows and where lines are picked for a commit. On Android JGit makes
 * them (GitOps.diff); the line diff here serves the web stand-in and tests,
 * with the same numbering, so a selection means the same on both.
 */

/** Lines of context around each change, as git shows them. */
export const DIFF_CONTEXT = 3;

export interface DiffLine {
  kind: 'context' | 'added' | 'removed';
  /** Without its line break. */
  text: string;
  /** 1-based; null on the side the line is not on. */
  oldLine: number | null;
  newLine: number | null;
  /** Numbers the file's changed lines in order (null for context): how a commit leaves lines out. */
  index: number | null;
  /** The file ends on this line without a line break. */
  noNewline?: boolean;
}

/** Changed lines and the context around them; starts and counts as in git's "@@ -a,b +c,d @@". */
export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface FileDiff {
  /** Names the two contents the hunks come from; lines picked on them are checked against it at commit. */
  version: string;
  /** Binary and too large files have no hunks: they are committed whole. */
  binary: boolean;
  tooLarge: boolean;
  hunks: Hunk[];
}

/** Changed lines ([DiffLine.index]) to leave out of a commit, picked on the diff [version]. */
export interface LineExclusion {
  version: string;
  lines: readonly number[];
}

/** The changed lines of [diff], in order. */
export const changedLines = (diff: FileDiff): DiffLine[] =>
  diff.hunks.flatMap((hunk) => hunk.lines.filter((line) => line.index !== null));

/** Old lines [beginA, endA) replaced by new lines [beginB, endB), like JGit's Edit. */
interface Edit {
  beginA: number;
  endA: number;
  beginB: number;
  endB: number;
}

interface Line {
  /** With its line break, if it has one. */
  raw: string;
  text: string;
}

const splitLines = (text: string): Line[] =>
  (text.match(/[^\n]*\n|[^\n]+$/g) ?? []).map((raw) => ({ raw, text: raw.replace(/\r?\n$/, '') }));

/** Past this many cells (lines × lines) the middle of a change is one replaced block, not a minimal diff. */
const MAX_CELLS = 4_000_000;

/** A minimal line diff: common start and end trimmed, then the longest common subsequence. */
function edits(a: Line[], b: Line[]): Edit[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start].raw === b[start].raw) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1].raw === b[endB - 1].raw) {
    endA--;
    endB--;
  }
  const n = endA - start;
  const m = endB - start;
  if (n === 0 && m === 0) return [];
  if (n === 0 || m === 0 || n * m > MAX_CELLS) return [{ beginA: start, endA, beginB: start, endB }];

  // lcs[i][j]: longest common subsequence of a[start + i..endA) and b[start + j..endB)
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        a[start + i].raw === b[start + j].raw ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const result: Edit[] = [];
  let i = 0;
  let j = 0;
  let open: Edit | null = null;
  while (i < n || j < m) {
    if (i < n && j < m && a[start + i].raw === b[start + j].raw) {
      open = null;
      i++;
      j++;
      continue;
    }
    if (!open) {
      open = { beginA: start + i, endA: start + i, beginB: start + j, endB: start + j };
      result.push(open);
    }
    // Removed lines come before added ones within a change, as in git.
    if (j >= m || (i < n && lcs[i + 1][j] >= lcs[i][j + 1])) {
      i++;
      open.endA = start + i;
    } else {
      j++;
      open.endB = start + j;
    }
  }
  return result;
}

const changedCount = (list: Edit[]) =>
  list.reduce((sum, edit) => sum + edit.endA - edit.beginA + (edit.endB - edit.beginB), 0);

/** [before] → [after] as hunks, numbered like GitOps.diff. */
export function diffTexts(before: string, after: string): Hunk[] {
  const a = splitLines(before);
  const b = splitLines(after);
  const list = edits(a, b);
  const endsBare = (lines: Line[], i: number) => i === lines.length - 1 && !lines[i].raw.endsWith('\n');
  const context = (ai: number, bi: number): DiffLine => ({
    kind: 'context',
    text: a[ai].text,
    oldLine: ai + 1,
    newLine: bi + 1,
    index: null,
    ...(endsBare(a, ai) && { noNewline: true }),
  });

  const hunks: Hunk[] = [];
  let index = 0;
  for (let first = 0; first < list.length;) {
    let last = first;
    while (last + 1 < list.length && list[last + 1].beginA - list[last].endA <= 2 * DIFF_CONTEXT) last++;
    const aStart = Math.max(0, list[first].beginA - DIFF_CONTEXT);
    const bStart = Math.max(0, list[first].beginB - DIFF_CONTEXT);
    const aEnd = Math.min(a.length, list[last].endA + DIFF_CONTEXT);
    const bEnd = Math.min(b.length, list[last].endB + DIFF_CONTEXT);
    const lines: DiffLine[] = [];
    let ai = aStart;
    let bi = bStart;
    for (let k = first; k <= last; k++) {
      const edit = list[k];
      for (; ai < edit.beginA; ai++, bi++) lines.push(context(ai, bi));
      for (; ai < edit.endA; ai++) {
        lines.push({
          kind: 'removed',
          text: a[ai].text,
          oldLine: ai + 1,
          newLine: null,
          index: index++,
          ...(endsBare(a, ai) && { noNewline: true }),
        });
      }
      for (; bi < edit.endB; bi++) {
        lines.push({
          kind: 'added',
          text: b[bi].text,
          oldLine: null,
          newLine: bi + 1,
          index: index++,
          ...(endsBare(b, bi) && { noNewline: true }),
        });
      }
    }
    for (; ai < aEnd; ai++, bi++) lines.push(context(ai, bi));
    const oldLines = aEnd - aStart;
    const newLines = bEnd - bStart;
    // git numbers an empty side by the line before it
    hunks.push({
      oldStart: oldLines === 0 ? aStart : aStart + 1,
      oldLines,
      newStart: newLines === 0 ? bStart : bStart + 1,
      newLines,
      lines,
    });
    first = last + 1;
  }
  return hunks;
}

/**
 * [after] as committed when the [excluded] changed lines stay as they were:
 * a removed line left out is kept, an added line left out is not added.
 * Null when every changed line is left out (the file is not committed).
 */
export function applyExclusion(before: string, after: string, excluded: ReadonlySet<number>): string | null {
  const a = splitLines(before);
  const b = splitLines(after);
  const list = edits(a, b);
  if ([...excluded].filter((line) => line < changedCount(list)).length >= changedCount(list)) return null;
  let out = '';
  const copy = (lines: Line[], from: number, to: number) => {
    for (let k = from; k < to; k++) {
      // A last line without a break that is no longer last gets one.
      if (out !== '' && !out.endsWith('\n')) out += '\n';
      out += lines[k].raw;
    }
  };
  let ai = 0;
  let index = 0;
  for (const edit of list) {
    copy(a, ai, edit.beginA);
    for (let k = edit.beginA; k < edit.endA; k++) if (excluded.has(index++)) copy(a, k, k + 1);
    for (let k = edit.beginB; k < edit.endB; k++) if (!excluded.has(index++)) copy(b, k, k + 1);
    ai = edit.endA;
  }
  copy(a, ai, a.length);
  return out;
}
