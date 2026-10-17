import { describe, expect, it, vi } from 'vitest';
import { applyTheme, onAccent, parseThemeChoice, resolveTheme, THEME_EVENT } from './theme';

describe('themes (#44)', () => {
  it('reads a saved choice back, anything broken being dark', () => {
    expect(parseThemeChoice(null)).toEqual({ mode: 'dark' });
    expect(parseThemeChoice('{"mode":"light"}')).toEqual({ mode: 'light' });
    expect(parseThemeChoice('{"mode":"system"}')).toEqual({ mode: 'system' });
    expect(parseThemeChoice('{"mode":"custom","base":"light","accent":"#2F7CF6"}')).toEqual({
      mode: 'custom',
      base: 'light',
      accent: '#2f7cf6',
    });
    expect(parseThemeChoice('{"mode":"custom","base":"light","accent":"blue"}')).toEqual({ mode: 'dark' });
    expect(parseThemeChoice('{"mode":"neon"}')).toEqual({ mode: 'dark' });
    expect(parseThemeChoice('not json')).toEqual({ mode: 'dark' });
  });

  it('resolves the phone’s own appearance, and a custom base and accent', () => {
    expect(resolveTheme({ mode: 'system' }, true)).toEqual({ base: 'dark', accent: null });
    expect(resolveTheme({ mode: 'system' }, false)).toEqual({ base: 'light', accent: null });
    expect(resolveTheme({ mode: 'light' }, true)).toEqual({ base: 'light', accent: null });
    expect(resolveTheme({ mode: 'custom', base: 'dark', accent: '#8b5cf6' }, false)).toEqual({
      base: 'dark',
      accent: '#8b5cf6',
    });
  });

  it('writes on an accent in whatever reads on it', () => {
    expect(onAccent('#e10600')).toBe('#f2f2f2');
    expect(onAccent('#2f7cf6')).toBe('#f2f2f2');
    expect(onAccent('#f2a516')).toBe('#0a0a0a');
    expect(onAccent('#ffffff')).toBe('#0a0a0a');
  });

  it('puts a theme on the page, and takes a custom accent off again', () => {
    // The tests run without a DOM: just what applyTheme touches
    const properties = new Map<string, string>();
    const meta = { setAttribute: vi.fn() };
    const dispatchEvent = vi.fn();
    const root = {
      dataset: {} as Record<string, string>,
      style: {
        setProperty: (name: string, value: string) => properties.set(name, value),
        removeProperty: (name: string) => properties.delete(name),
      },
      ownerDocument: { querySelector: () => meta, defaultView: { dispatchEvent } },
    } as unknown as HTMLElement;

    applyTheme({ base: 'light', accent: '#2f7cf6' }, root);
    expect(root.dataset.theme).toBe('light');
    expect(properties.get('--primary')).toBe('#2f7cf6');
    expect(properties.get('--on-primary')).toBe('#f2f2f2');
    expect(meta.setAttribute).toHaveBeenLastCalledWith('content', '#f4f2ec');

    applyTheme({ base: 'dark', accent: null }, root);
    expect(root.dataset.theme).toBe('dark');
    expect(properties.has('--primary')).toBe(false);
    expect(dispatchEvent).toHaveBeenCalledTimes(2);
    expect((dispatchEvent.mock.calls[1][0] as CustomEvent).type).toBe(THEME_EVENT);
  });
});
