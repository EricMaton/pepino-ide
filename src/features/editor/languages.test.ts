import { describe, expect, it } from 'vitest';
import { languageFor } from './languages';

describe('languageFor', () => {
  it.each([
    ['main.ts', 'typescript'],
    ['App.tsx', 'tsx'],
    ['vite.config.mjs', 'javascript'],
    ['package.json', 'json'],
    ['README.MD', 'markdown'],
    ['index.html', 'html'],
    ['style.css', 'css'],
    ['script.py', 'python'],
    ['MainActivity.kt', 'kotlin'],
    ['build.gradle.kts', 'kotlin'],
    ['ci.yml', 'yaml'],
    ['deploy.sh', 'shell'],
  ])('maps %j to %j', (name, id) => {
    expect(languageFor(name)?.id).toBe(id);
  });

  it.each(['Makefile', '.gitignore', 'notes.txt', 'archive.unknownext', 'trailing.'])(
    'treats %j as plain text',
    (name) => {
      expect(languageFor(name)).toBeNull();
    },
  );

  it('loads grammars lazily', async () => {
    await expect(languageFor('a.ts')!.load()).resolves.toBeDefined();
    await expect(languageFor('a.kt')!.load()).resolves.toBeDefined();
  });
});
