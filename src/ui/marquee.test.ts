import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOLD_MS, installMarquee, marqueeOffset } from './marquee';

describe('marqueeOffset', () => {
  it('waits, slides to the end at a readable pace, waits longer, and starts again', () => {
    // 120 px too long: 2 s of sliding at 60 px/s, between a 0.4 s and a 1.2 s pause
    expect(marqueeOffset(0, 120)).toBe(0);
    expect(marqueeOffset(399, 120)).toBe(0);
    expect(marqueeOffset(1400, 120)).toBeCloseTo(60);
    expect(marqueeOffset(2400, 120)).toBe(120);
    expect(marqueeOffset(3500, 120)).toBe(120);
    expect(marqueeOffset(3600 + 100, 120)).toBe(0); // the next round's pause
  });

  it('shows the end at once with reduced motion, and nothing moves when the text fits', () => {
    expect(marqueeOffset(0, 120, true)).toBe(120);
    expect(marqueeOffset(5000, 0)).toBe(0);
    expect(marqueeOffset(5000, -3)).toBe(0);
  });
});

/** An `.ellipsis` element, [overflow] px too long for its box. */
function fakeText(overflow: number) {
  const classes = new Set<string>();
  const element = {
    clientWidth: 200,
    scrollWidth: 200 + overflow,
    scrollLeft: 0,
    classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name) },
    closest: () => element,
    scrollTo: vi.fn(({ left }: { left: number }) => {
      element.scrollLeft = left;
    }),
    classes,
  };
  return element;
}

describe('installMarquee', () => {
  let root: EventTarget & { defaultView: unknown };
  let stop: () => void;

  /** Dispatches [type] on [root] as if on [target]; returns whether it was let through. */
  const fire = (type: string, target: unknown, init: Record<string, unknown> = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { isPrimary: true, button: 0, clientX: 10, clientY: 10, ...init });
    Object.defineProperty(event, 'target', { value: target });
    return root.dispatchEvent(event);
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    root = Object.assign(new EventTarget(), {
      defaultView: {
        setTimeout,
        clearTimeout,
        requestAnimationFrame: (step: (now: number) => void) => setTimeout(() => step(performance.now()), 16),
        cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
        matchMedia: () => ({ matches: false }),
      },
    });
    stop = installMarquee(root as unknown as Document);
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  it('slides cut-off text while held, and the tap that ends the hold does not go through', () => {
    const text = fakeText(120);
    fire('pointerdown', text);
    vi.advanceTimersByTime(HOLD_MS - 10);
    expect(text.classes.has('marquee')).toBe(false);

    vi.advanceTimersByTime(10 + 1400);
    expect(text.classes.has('marquee')).toBe(true);
    expect(text.scrollLeft).toBeGreaterThan(40);

    fire('pointerup', text);
    expect(text.scrollTo).toHaveBeenCalledWith({ left: 0, behavior: 'smooth' });
    expect(fire('click', text)).toBe(false);
    // only that one
    expect(fire('click', text)).toBe(true);
    vi.advanceTimersByTime(500);
    expect(text.classes.has('marquee')).toBe(false);
  });

  it('a quick tap, a scroll or text that fits do nothing', () => {
    const text = fakeText(120);
    fire('pointerdown', text);
    vi.advanceTimersByTime(100);
    fire('pointerup', text);
    expect(fire('click', text)).toBe(true);

    fire('pointerdown', text);
    fire('pointermove', text, { clientY: 40 });
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(text.classes.has('marquee')).toBe(false);
    fire('pointerup', text);

    const fits = fakeText(0);
    fire('pointerdown', fits);
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(fits.classes.has('marquee')).toBe(false);
  });

  it('keeps Android’s long-press menu away, and a cancelled touch lets the next tap through', () => {
    const text = fakeText(120);
    fire('pointerdown', text);
    vi.advanceTimersByTime(HOLD_MS + 50);
    expect(fire('contextmenu', text)).toBe(false);
    fire('pointercancel', text);
    expect(fire('click', text)).toBe(true);
  });
});
