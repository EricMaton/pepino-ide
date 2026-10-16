import { describe, expect, it } from 'vitest';
import { applyExclusion, changedLines, diffTexts, type Hunk } from './diff';

const numbered = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `line ${from + i}\n`).join('');

const marks = (hunk: Hunk) =>
  hunk.lines.map((line) => `${line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}${line.text}`);

describe('diffTexts', () => {
  // The same case as GitOpsTest.diffShowsHunksWithThreeLinesOfContextAndBothLineNumbers
  it('makes hunks with three lines of context, numbered like JGit', () => {
    const after = numbered(1, 20).replace('line 2\n', 'line two\n').replace('line 18\n', '') + 'line 21\n';
    const [first, second, ...rest] = diffTexts(numbered(1, 20), after);

    expect(rest).toEqual([]);
    expect(marks(first)).toEqual([' line 1', '-line 2', '+line two', ' line 3', ' line 4', ' line 5']);
    expect([first.oldStart, first.oldLines, first.newStart, first.newLines]).toEqual([1, 5, 1, 5]);
    expect(first.lines[1]).toEqual({ kind: 'removed', text: 'line 2', oldLine: 2, newLine: null, index: 0 });
    expect(first.lines[2]).toEqual({ kind: 'added', text: 'line two', oldLine: null, newLine: 2, index: 1 });
    expect(marks(second)).toEqual([' line 15', ' line 16', ' line 17', '-line 18', ' line 19', ' line 20', '+line 21']);
    expect(second.lines[4]).toEqual({ kind: 'context', text: 'line 19', oldLine: 19, newLine: 18, index: null });
    expect(second.lines[3].index).toBe(2);
    expect(second.lines[6].index).toBe(3);
  });

  it('shows a new file, CRLF and a missing final newline', () => {
    const [hunk] = diffTexts('', 'a\r\nb');
    expect(marks(hunk)).toEqual(['+a', '+b']);
    expect([hunk.oldStart, hunk.oldLines, hunk.newStart, hunk.newLines]).toEqual([0, 0, 1, 2]);
    expect(hunk.lines[1].noNewline).toBe(true);
    expect(diffTexts('same\n', 'same\n')).toEqual([]);
  });

  it('numbers the changed lines across hunks', () => {
    const diff = { version: '', binary: false, tooLarge: false, hunks: diffTexts(numbered(1, 20), numbered(2, 19)) };
    expect(changedLines(diff).map((line) => [line.index, line.text])).toEqual([
      [0, 'line 1'],
      [1, 'line 20'],
    ]);
  });
});

describe('applyExclusion', () => {
  // The same cases as GitOpsTest.commitLeavesOutTheExcludedLines and commitOfSomeLinesOfANewFile…
  it('keeps removed lines and drops added ones that are left out', () => {
    // 0: -two, 1: +2, 2: +four
    expect(applyExclusion('one\ntwo\nthree\n', 'one\n2\nthree\nfour\n', new Set([0, 2]))).toBe('one\ntwo\n2\nthree\n');
    expect(applyExclusion('one\ntwo\nthree\n', 'one\n2\nthree\nfour\n', new Set([1]))).toBe('one\nthree\nfour\n');
  });

  it('builds part of a new file, and nothing when every line is left out', () => {
    expect(applyExclusion('', 'a\nb\nc', new Set([1]))).toBe('a\nc');
    expect(applyExclusion('a\nc', 'a\nb\nc\nd\n', new Set([0, 1, 2, 3]))).toBeNull();
  });

  it('gives a kept last line its line break when lines follow it', () => {
    // 0: -c (no newline), 1: +c\n, 2: +d
    expect(applyExclusion('a\nc', 'a\nc\nd\n', new Set([0, 1]))).toBe('a\nc\nd\n');
  });
});
