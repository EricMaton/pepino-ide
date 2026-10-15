import { describe, expect, it } from 'vitest';
import {
  type FileEntry,
  fileBadge,
  formatModified,
  formatSize,
  isValidEntryName,
  nextSortOrder,
  sortEntries,
} from './files';

const entry = (name: string, isDirectory: boolean, sizeBytes = 0, modifiedMillis = 0): FileEntry => ({
  name,
  path: name,
  isDirectory,
  sizeBytes,
  modifiedMillis,
});

describe('sortEntries', () => {
  const entries = [
    entry('b.txt', false, 10, 3),
    entry('Zeta', true, 0, 1),
    entry('a.txt', false, 10, 5),
    entry('alpha', true, 0, 2),
    entry('C.md', false, 99, 1),
  ];

  it('puts directories first, then names case-insensitively', () => {
    expect(sortEntries(entries, 'name').map((e) => e.name)).toEqual(['alpha', 'Zeta', 'a.txt', 'b.txt', 'C.md']);
  });

  it('sorts by size descending with name as tiebreaker', () => {
    expect(sortEntries(entries, 'size').map((e) => e.name)).toEqual(['alpha', 'Zeta', 'C.md', 'a.txt', 'b.txt']);
  });

  it('sorts by most recently modified', () => {
    expect(sortEntries(entries, 'modified').map((e) => e.name)).toEqual(['alpha', 'Zeta', 'a.txt', 'b.txt', 'C.md']);
  });

  it('does not mutate its input', () => {
    const copy = [...entries];
    sortEntries(entries, 'size');
    expect(entries).toEqual(copy);
  });
});

describe('nextSortOrder', () => {
  it('cycles name -> size -> modified -> name', () => {
    expect(nextSortOrder('name')).toBe('size');
    expect(nextSortOrder('size')).toBe('modified');
    expect(nextSortOrder('modified')).toBe('name');
  });
});

describe('isValidEntryName', () => {
  it.each(['a', 'file.txt', ' spaced ', '.gitignore'])('accepts %j', (name) => {
    expect(isValidEntryName(name)).toBe(true);
  });

  it.each(['', '   ', '.', '..', 'a/b', 'a\\b'])('rejects %j', (name) => {
    expect(isValidEntryName(name)).toBe(false);
  });
});

describe('formatSize', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [1024 * 1024 - 1, '1023.9 KB'],
    [5 * 1024 ** 3, '5.0 GB'],
  ])('formats %d bytes as %j', (bytes, expected) => {
    expect(formatSize(bytes)).toBe(expected);
  });
});

describe('formatModified', () => {
  it('formats local date and time', () => {
    expect(formatModified(new Date(2026, 0, 2, 3, 4).getTime())).toBe('2026-01-02 03:04');
  });

  it('shows a dash for unknown times', () => {
    expect(formatModified(0)).toBe('—');
  });
});

describe('fileBadge', () => {
  it.each([
    ['main.ts', 'TS'],
    ['package.json', 'JSON'],
    ['archive.tar.gz', 'GZ'],
    ['notes.markdown', 'MARK'],
    ['Makefile', '··'],
    ['.gitignore', '··'],
    ['trailing.', '··'],
  ])('tags %j as %j', (name, expected) => {
    expect(fileBadge(name)).toBe(expected);
  });
});
