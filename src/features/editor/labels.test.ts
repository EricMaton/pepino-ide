import { describe, expect, it } from 'vitest';
import { folderLabelFor } from './labels';

describe('folderLabelFor', () => {
  it('labels files relative to the explorer root', () => {
    expect(folderLabelFor('app/main.ts', 'app', 'app')).toBe('app');
    expect(folderLabelFor('app/src/ui/a.ts', 'app', 'app')).toBe('app/src/ui');
    expect(folderLabelFor('notes.md', '', '~/projects')).toBe('~/projects');
    expect(folderLabelFor('loose/notes.md', '', '~/projects')).toBe('~/projects/loose');
  });
});
