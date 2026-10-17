import { describe, expect, it } from 'vitest';
import type { AppDestination } from './destinations';
import { DEFAULT_PINNED, layoutNav, parsePinned, pin, unpin } from './navLayout';

const ALL: AppDestination[] = ['projects', 'git', 'terminal', 'plugins', 'settings'];

describe('the bottom bar (#171)', () => {
  it('by default: projects, git, terminal and settings; plugins behind MORE', () => {
    expect(layoutNav(ALL, DEFAULT_PINNED)).toEqual({
      bar: ['projects', 'git', 'terminal', 'settings'],
      more: ['plugins'],
    });
  });

  it('settings always stays; what is not available (no terminal on iOS) is left out', () => {
    expect(layoutNav(['projects', 'git', 'plugins', 'settings'], ['projects', 'terminal'])).toEqual({
      bar: ['projects', 'settings'],
      more: ['git', 'plugins'],
    });
    expect(unpin(DEFAULT_PINNED, 'settings')).toEqual(DEFAULT_PINNED);
  });

  it('moves a destination to MORE, and pins one back before settings while there is room', () => {
    const fewer = unpin(DEFAULT_PINNED, 'terminal');
    expect(layoutNav(ALL, fewer)).toEqual({ bar: ['projects', 'git', 'settings'], more: ['terminal', 'plugins'] });

    const withPlugins = pin(fewer, 'plugins', ALL);
    expect(withPlugins).toEqual(['projects', 'git', 'plugins', 'settings']);
    // Full: nothing more until one goes
    expect(pin(withPlugins!, 'terminal', ALL)).toBeNull();
  });

  it('a saved bar longer than fits keeps settings and drops from the end', () => {
    expect(layoutNav(ALL, ['plugins', 'projects', 'git', 'terminal', 'settings']).bar).toEqual([
      'plugins',
      'projects',
      'git',
      'settings',
    ]);
  });

  it('reads the saved bar back, anything broken or unknown being the default', () => {
    expect(parsePinned('["git","settings","nope"]', ALL)).toEqual(['git', 'settings']);
    expect(parsePinned(null, ALL)).toEqual(DEFAULT_PINNED);
    expect(parsePinned('{', ALL)).toEqual(DEFAULT_PINNED);
  });
});
