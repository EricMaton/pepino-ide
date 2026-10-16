import { describe, expect, it } from 'vitest';
import { stackTo } from './useFolderStack';

describe('stackTo', () => {
  it('walks from the root down to the start folder', () => {
    expect(stackTo('', '')).toEqual(['']);
    expect(stackTo('', 'a/b/c')).toEqual(['', 'a', 'a/b', 'a/b/c']);
    expect(stackTo('a', 'a/b/c')).toEqual(['a', 'a/b', 'a/b/c']);
    expect(stackTo('a', 'a')).toEqual(['a']);
  });
});
