import { describe, expect, it } from 'vitest';
import { ProjectSpaceError } from './errors';
import { basename, isWithin, joinPath, parentPath, resolveInRoot } from './paths';

describe('resolveInRoot', () => {
  it.each([
    ['', ''],
    ['/', ''],
    ['a', 'a'],
    ['/a/b/', 'a/b'],
    ['a//b', 'a/b'],
    ['./a/./b', 'a/b'],
    ['a/b/../c', 'a/c'],
    ['a/..', ''],
    ['a\\b', 'a/b'],
  ])('normalizes %j to %j', (input, expected) => {
    expect(resolveInRoot(input)).toBe(expected);
  });

  it.each(['..', '../a', 'a/../..', '/../etc/passwd', 'a\\..\\..\\b'])('rejects %j', (input) => {
    expect(() => resolveInRoot(input)).toThrow(ProjectSpaceError);
    try {
      resolveInRoot(input);
    } catch (error) {
      expect((error as ProjectSpaceError).code).toBe('EscapesRoot');
    }
  });
});

describe('path helpers', () => {
  it('joins against the root without a leading slash', () => {
    expect(joinPath('', 'a')).toBe('a');
    expect(joinPath('a', 'b')).toBe('a/b');
  });

  it('splits basename and parent', () => {
    expect(basename('a/b/c')).toBe('c');
    expect(basename('a')).toBe('a');
    expect(basename('')).toBe('');
    expect(parentPath('a/b/c')).toBe('a/b');
    expect(parentPath('a')).toBe('');
  });

  it('knows when a path lives below another', () => {
    expect(isWithin('a/b', 'a')).toBe(true);
    expect(isWithin('a', 'a')).toBe(true);
    expect(isWithin('ab', 'a')).toBe(false);
    expect(isWithin('anything', '')).toBe(true);
  });
});
