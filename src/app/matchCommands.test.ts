import { describe, expect, it } from 'vitest';
import type { Command } from '../core/commands';
import { matchCommands } from './matchCommands';

const command = (id: string, title: string, hidden = false): Command => ({ id, title, hidden, run: () => {} });

const commands = [
  command('editor.close', 'Close main.ts'),
  command('editor.save', 'Save main.ts'),
  command('editor.revert', 'Revert main.ts to the opened version'),
  command('editor.undo', 'Undo'),
  command('editor.insert.braces', 'Insert {}', true),
  command('project.close', 'Close project demo'),
];
const ids = (query: string) => matchCommands(commands, query).map((c) => c.id);

describe('matchCommands', () => {
  it('lists every visible command for an empty query, in registration order', () => {
    expect(ids('  ')).toEqual(['editor.close', 'editor.save', 'editor.revert', 'editor.undo', 'project.close']);
  });

  it('never returns hidden commands', () => {
    expect(ids('insert')).toEqual([]);
  });

  it('ranks titles that start with the query first', () => {
    expect(ids('close')).toEqual(['editor.close', 'project.close']);
    expect(ids('main')).toEqual(['editor.close', 'editor.save', 'editor.revert']);
    expect(ids('sa')[0]).toBe('editor.save');
  });

  it('requires every word, in any order, across title and id', () => {
    expect(ids('project close')).toEqual(['project.close']);
    expect(ids('editor revert')).toEqual(['editor.revert']);
    expect(ids('save project')).toEqual([]);
  });

  it('is case-insensitive', () => {
    expect(ids('UNDO')).toEqual(['editor.undo']);
  });

  it('puts the commands of the current screen first without hiding the rest', () => {
    const withDemo = [command('demo.hello', 'Say hello'), ...commands];
    expect(matchCommands(withDemo, '', 'editor.').map((c) => c.id)).toEqual([
      'editor.close',
      'editor.save',
      'editor.revert',
      'editor.undo',
      'demo.hello',
      'project.close',
    ]);
    expect(matchCommands(withDemo, 'close', 'project.').map((c) => c.id)).toEqual(['project.close', 'editor.close']);
  });
});
