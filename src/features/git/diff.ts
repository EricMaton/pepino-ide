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
  /** Not a line but the file's final line break, added or removed (empty text, no line numbers). */
  endOfFile?: boolean;
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
  /** Without its '\n' (a '\r' before it stays): what lines are compared by, as in GitOps. */
  raw: string;
  text: string;
}

const splitLines = (text: string): Line[] =>
  (text.match(/[^\n]*\n|[^\n]+$/g) ?? []).map((line) => {
    const raw = line.endsWith('\n') ? line.slice(0, -1) : line;
    return { raw, text: raw.replace(/\r$/, '') };
  });

/**
 * [before] and [after] as lines, and how each ends: bare when its last line
 * has no line break (an empty side ends like the other). When they differ,
 * that final line break is one more changed line, numbered after the others.
 */
function sidesOf(before: string, after: string) {
  const a = splitLines(before);
  const b = splitLines(after);
  const oldBare = before !== '' ? !before.endsWith('\n') : after !== '' && !after.endsWith('\n');
  const newBare = after !== '' ? !after.endsWith('\n') : oldBare;
  return { a, b, list: edits(a, b), oldBare, newBare, endOfFile: oldBare !== newBare };
}

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
  const { a, b, list: changes, oldBare, newBare, endOfFile } = sidesOf(before, after);
  // The final line break, when it changed, is an empty edit at the end: it gets its hunk and context too.
  const list = endOfFile
    ? [...changes, { beginA: a.length, endA: a.length, beginB: b.length, endB: b.length }]
    : changes;
  const endsBare = (lines: Line[], i: number) => i === lines.length - 1 && (lines === a ? oldBare : newBare);
  // A context line ends the file as it is now.
  const context = (ai: number, bi: number): DiffLine => ({
    kind: 'context',
    text: a[ai].text,
    oldLine: ai + 1,
    newLine: bi + 1,
    index: null,
    ...(endsBare(b, bi) && { noNewline: true }),
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
      if (edit.beginA === edit.endA && edit.beginB === edit.endB) {
        lines.push({
          kind: newBare ? 'removed' : 'added',
          text: '',
          oldLine: null,
          newLine: null,
          index: index++,
          endOfFile: true,
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
 * a removed line left out is kept, an added line left out is not added, and
 * the final line break is the old one unless its change is committed.
 * Null when every changed line is left out (the file is not committed).
 */
export function applyExclusion(before: string, after: string, excluded: ReadonlySet<number>): string | null {
  const { a, b, list, oldBare, newBare, endOfFile } = sidesOf(before, after);
  const total = changedCount(list) + (endOfFile ? 1 : 0);
  if ([...excluded].filter((line) => line < total).length >= total) return null;
  const kept: string[] = [];
  let ai = 0;
  let index = 0;
  for (const edit of list) {
    for (; ai < edit.beginA; ai++) kept.push(a[ai].raw);
    for (let k = edit.beginA; k < edit.endA; k++) if (excluded.has(index++)) kept.push(a[k].raw);
    for (let k = edit.beginB; k < edit.endB; k++) if (!excluded.has(index++)) kept.push(b[k].raw);
    ai = edit.endA;
  }
  for (; ai < a.length; ai++) kept.push(a[ai].raw);
  const bare = endOfFile && !excluded.has(index) ? newBare : oldBare;
  // Lines are joined by '\n' (a '\r' stays with its line), so every line but the last has one.
  return kept.length === 0 ? '' : kept.join('\n') + (bare ? '' : '\n');
}
