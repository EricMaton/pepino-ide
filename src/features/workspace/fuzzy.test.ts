import { describe, expect, it } from 'vitest';
import { fuzzyFind, fuzzyScore } from './fuzzy';

const paths = [
  'app/src/features/editor/EditorScreen.tsx',
  'app/src/features/editor/CodeEditor.tsx',
  'app/src/features/projects/FileExplorer.tsx',
  'app/src/app/App.tsx',
  'app/package.json',
  'app/README.md',
  'app/src/ui/components.tsx',
];

describe('fuzzyScore', () => {
  it('needs every character in order', () => {
    expect(fuzzyScore('edsc', 'app/src/features/editor/EditorScreen.tsx')).not.toBeNull();
    expect(fuzzyScore('xyz', 'app/README.md')).toBeNull();
    expect(fuzzyScore('mdr', 'app/README.md')).toBeNull();
  });

  it('treats an empty query as a neutral match', () => {
    expect(fuzzyScore('  ', 'anything')).toBe(0);
  });
});

describe('fuzzyFind', () => {
  it('finds files by initials of their words', () => {
    expect(fuzzyFind('ES', paths)[0]).toBe('app/src/features/editor/EditorScreen.tsx');
    expect(fuzzyFind('fe', paths)[0]).toBe('app/src/features/projects/FileExplorer.tsx');
  });

  it('prefers matches in the file name and contiguous runs', () => {
    expect(fuzzyFind('readme', paths)[0]).toBe('app/README.md');
    expect(fuzzyFind('app.tsx', paths)[0]).toBe('app/src/app/App.tsx');
    expect(fuzzyFind('pack', paths)[0]).toBe('app/package.json');
  });

  it('ignores spaces and case, and respects the limit', () => {
    expect(fuzzyFind('code editor', paths)[0]).toBe('app/src/features/editor/CodeEditor.tsx');
    expect(fuzzyFind('tsx', paths, 2)).toHaveLength(2);
  });
});
