import { describe, expect, it } from 'vitest';
import { diffTexts, type FileDiff } from './diff';
import { excludedLines, selectionOf, toggleLines } from './selection';

// 0: -two, 1: +2, 2: +four
const diff: FileDiff = {
  version: 'v1',
  binary: false,
  tooLarge: false,
  hunks: diffTexts('one\ntwo\nthree\n', 'one\n2\nthree\nfour\n'),
};

describe('line selection', () => {
  it('leaves out no line, every line, or the picked ones of the same version', () => {
    expect([...excludedLines(diff, 'all')]).toEqual([]);
    expect([...excludedLines(diff, 'none')]).toEqual([0, 1, 2]);
    expect([...excludedLines(diff, { version: 'v1', lines: [2] })]).toEqual([2]);
    expect([...excludedLines(diff, { version: 'old', lines: [2] })]).toEqual([]);
  });

  it('turns no line and every line into all and none', () => {
    expect(selectionOf(diff, new Set())).toBe('all');
    expect(selectionOf(diff, new Set([0, 1, 2]))).toBe('none');
    expect(selectionOf(diff, new Set([2, 0]))).toEqual({ version: 'v1', lines: [0, 2] });
  });

  it('toggles a line, and a hunk all in or all out', () => {
    const one = toggleLines(diff, 'all', [2]);
    expect(one).toEqual({ version: 'v1', lines: [2] });
    expect(toggleLines(diff, one, [2])).toBe('all');
    // Part of the hunk is out: a tap puts all of it in
    expect(toggleLines(diff, one, [0, 1, 2])).toBe('all');
    expect(toggleLines(diff, 'all', [0, 1, 2])).toBe('none');
    expect(toggleLines(diff, 'none', [1])).toEqual({ version: 'v1', lines: [0, 2] });
  });
});
