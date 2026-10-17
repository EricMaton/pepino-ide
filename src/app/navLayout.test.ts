import { describe, expect, it } from 'vitest';
import type { AppDestination } from './destinations';
import { DEFAULT_ORDER, layoutNav, moveDestination, type NavOrder, parseNavOrder } from './navLayout';

const ALL: AppDestination[] = ['projects', 'git', 'terminal', 'plugins', 'settings'];

const move = (order: NavOrder, id: AppDestination, zone: 'bar' | 'more', index: number) => {
  const result = moveDestination(ALL, order, id, { zone, index });
  if ('refused' in result) throw new Error(result.refused);
  return result;
};

describe('the bottom bar (#171)', () => {
  it('by default: projects, git, terminal and settings; plugins (and anything new) in MORE', () => {
    expect(layoutNav(ALL, DEFAULT_ORDER)).toEqual({
      bar: ['projects', 'git', 'terminal', 'settings'],
      more: ['plugins'],
    });
  });

  it('settings always stays; what is not available (no terminal on iOS) is left out', () => {
    expect(layoutNav(['projects', 'git', 'plugins', 'settings'], { bar: ['projects', 'terminal'], more: [] })).toEqual({
      bar: ['projects', 'settings'],
      more: ['git', 'plugins'],
    });
    expect(moveDestination(ALL, DEFAULT_ORDER, 'settings', { zone: 'more', index: 0 })).toEqual({
      refused: 'always-pinned',
    });
  });

  it('reorders the bar, settings included', () => {
    expect(move(DEFAULT_ORDER, 'terminal', 'bar', 0).order.bar).toEqual(['terminal', 'projects', 'git', 'settings']);
    expect(move(DEFAULT_ORDER, 'settings', 'bar', 1).order.bar).toEqual(['projects', 'settings', 'git', 'terminal']);
  });

  it('drags one into MORE, in the place it is dropped, and back into the bar while there is room', () => {
    const out = move(DEFAULT_ORDER, 'git', 'more', 1).order;
    expect(layoutNav(ALL, out)).toEqual({ bar: ['projects', 'terminal', 'settings'], more: ['plugins', 'git'] });

    const back = move(out, 'plugins', 'bar', 1);
    expect(back.displaced).toBeUndefined();
    expect(layoutNav(ALL, back.order)).toEqual({
      bar: ['projects', 'plugins', 'terminal', 'settings'],
      more: ['git'],
    });
  });

  it('into a full bar, it swaps with the one it lands next to, never settings', () => {
    const swapped = move(DEFAULT_ORDER, 'plugins', 'bar', 2);
    expect(swapped.displaced).toBe('terminal');
    expect(layoutNav(ALL, swapped.order)).toEqual({
      bar: ['projects', 'git', 'plugins', 'settings'],
      more: ['terminal'],
    });
    // Dropped just before settings at the end: the neighbour that may go is the one before it
    const atEnd = move(DEFAULT_ORDER, 'plugins', 'bar', 4);
    expect(atEnd.displaced).toBe('terminal');
    expect(atEnd.order.bar).toEqual(['projects', 'git', 'settings', 'plugins']);
  });

  it('reorders MORE', () => {
    const order: NavOrder = { bar: ['projects', 'settings'], more: ['git', 'terminal', 'plugins'] };
    expect(move(order, 'plugins', 'more', 0).order.more).toEqual(['plugins', 'git', 'terminal']);
  });

  it('reads the saved arrangement back, anything broken or unknown being left out', () => {
    expect(parseNavOrder('{"bar":["git","settings","nope"],"more":["plugins"]}', ALL)).toEqual({
      bar: ['git', 'settings'],
      more: ['plugins'],
    });
    expect(parseNavOrder(null, ALL)).toEqual(DEFAULT_ORDER);
    expect(parseNavOrder('{', ALL)).toEqual(DEFAULT_ORDER);
  });
});
