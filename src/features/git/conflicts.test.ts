import { describe, expect, it } from 'vitest';
import { conflictCount, hasConflicts, parseConflicts, resolveConflicts } from './conflicts';

const FILE = [
  'one\n',
  '<<<<<<< HEAD\n',
  'my two\n',
  '=======\n',
  "mate's two\n",
  '>>>>>>> refs/remotes/origin/main\n',
  'three\n',
  '<<<<<<< HEAD\n',
  'my end\n',
  '||||||| base\n',
  'old end\n',
  '=======\n',
  '>>>>>>> origin/main\n',
].join('');

describe('merge conflicts in a file (#143)', () => {
  it('reads the text and each conflict, with both sides and their labels', () => {
    const segments = parseConflicts(FILE);

    expect(segments).toEqual([
      { kind: 'text', text: 'one\n' },
      {
        kind: 'conflict',
        ours: 'my two\n',
        theirs: "mate's two\n",
        oursLabel: 'HEAD',
        theirsLabel: 'refs/remotes/origin/main',
      },
      { kind: 'text', text: 'three\n' },
      // diff3's base is left out; GitHub deleted the lines
      { kind: 'conflict', ours: 'my end\n', theirs: '', oursLabel: 'HEAD', theirsLabel: 'origin/main' },
    ]);
    expect(conflictCount(segments)).toBe(2);
    expect(hasConflicts(FILE)).toBe(true);
  });

  it('gives the file once every conflict has a side', () => {
    const segments = parseConflicts(FILE);

    expect(resolveConflicts(segments, ['ours'])).toBeNull();
    expect(resolveConflicts(segments, ['theirs', 'theirs'])).toBe("one\nmate's two\nthree\n");
    expect(resolveConflicts(segments, ['both', 'ours'])).toBe("one\nmy two\nmate's two\nthree\nmy end\n");
  });

  it('a file without conflicts, or with one left unfinished, is just text', () => {
    expect(parseConflicts('a\nb')).toEqual([{ kind: 'text', text: 'a\nb' }]);
    const unfinished = '<<<<<<< HEAD\nmine\n=======\ntheirs\n';
    expect(parseConflicts(unfinished)).toEqual([{ kind: 'text', text: unfinished }]);
    expect(hasConflicts(unfinished)).toBe(false);
    // A line that merely starts like a marker is not one
    expect(hasConflicts('<<<<<<<<< not a marker\n=======\n>>>>>>>>>\n')).toBe(false);
  });

  it('both sides keep a line break between them', () => {
    const segments = parseConflicts('<<<<<<< HEAD\nmine=======\ntheirs\n>>>>>>> x\n');
    expect(segments).toEqual([{ kind: 'text', text: '<<<<<<< HEAD\nmine=======\ntheirs\n>>>>>>> x\n' }]);
    const bare = parseConflicts('<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> x');
    expect(resolveConflicts(bare, ['both'])).toBe('mine\ntheirs\n');
  });
});
