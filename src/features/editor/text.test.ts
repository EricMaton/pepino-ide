import { Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { detectLineSeparator, serialize } from './text';

describe('detectLineSeparator', () => {
  it.each([
    ['a\nb\n', '\n'],
    ['a\r\nb\r\n', '\r\n'],
    ['a\rb\r', '\r'],
    ['single line', '\n'],
    ['', '\n'],
    ['mostly\r\ncrlf\r\nwith\none lf', '\r\n'],
    ['mostly\nlf\nwith\r\none crlf', '\n'],
  ])('detects %j as %j', (text, expected) => {
    expect(detectLineSeparator(text)).toBe(expected);
  });
});

describe('serialize', () => {
  it('round-trips CRLF files', () => {
    const original = 'line 1\r\nline 2\r\n';
    const doc = Text.of(original.split(/\r\n?|\n/));
    expect(serialize(doc, detectLineSeparator(original))).toBe(original);
  });

  it('keeps LF files as LF', () => {
    expect(serialize(Text.of(['a', 'b']), '\n')).toBe('a\nb');
  });
});
