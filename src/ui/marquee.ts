/*
 * Truncated text (the `.ellipsis` class, everywhere in the app) shows the rest
 * when held: after a moment it slides right to left to its end, waits, and
 * starts again while the finger stays down; let go and it slides back.
 * One listener on the document does it for every `.ellipsis`, present or
 * future. Text that fits does nothing, a finger that moves (a scroll) cancels
 * it, and the tap that ends a hold does not go through: holding to read a
 * file's name never opens it.
 */

/** How long a finger stays down before the text moves. */
export const HOLD_MS = 450;
/** How far a finger may move and still be holding (more is a scroll). */
const SLOP_PX = 10;
/** Sliding speed, slow enough to read. */
const SPEED_PX_PER_S = 60;
/** The wait before sliding, and at the end before starting again. */
const PAUSE_START_MS = 400;
const PAUSE_END_MS = 1200;

/**
 * How far the text is slid [elapsed] ms into a hold, for a text [overflow] px
 * longer than its box: a pause, the slide, a longer pause at the end, again.
 * With [reducedMotion] it shows the end at once, without moving.
 */
export function marqueeOffset(elapsed: number, overflow: number, reducedMotion = false): number {
  if (overflow <= 0) return 0;
  if (reducedMotion) return overflow;
  const slide = (overflow / SPEED_PX_PER_S) * 1000;
  const t = elapsed % (PAUSE_START_MS + slide + PAUSE_END_MS);
  if (t < PAUSE_START_MS) return 0;
  return Math.min(overflow, ((t - PAUSE_START_MS) / slide) * overflow);
}

/** Whether [element] cuts its text short. */
const truncated = (element: HTMLElement) => element.scrollWidth - element.clientWidth > 1;

/** Starts listening on [root]; returns the stop. */
export function installMarquee(root: Document = document): () => void {
  const view = root.defaultView ?? window;
  let pending: { element: HTMLElement; x: number; y: number; timer: number } | null = null;
  let running: { element: HTMLElement; frame: number } | null = null;

  const cancelPending = () => {
    if (pending) view.clearTimeout(pending.timer);
    pending = null;
  };

  const start = (element: HTMLElement) => {
    pending = null;
    const overflow = element.scrollWidth - element.clientWidth;
    const reduced = view.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const began = performance.now();
    element.classList.add('marquee');
    const step = (now: number) => {
      element.scrollLeft = marqueeOffset(now - began, overflow, reduced);
      if (running) running.frame = view.requestAnimationFrame(step);
    };
    running = { element, frame: view.requestAnimationFrame(step) };
  };

  /** Ends a hold; [held] when the text was moving, so the tap ending it must not go through. */
  const stop = (held: boolean) => {
    cancelPending();
    if (!running) return;
    const { element, frame } = running;
    running = null;
    view.cancelAnimationFrame(frame);
    element.scrollTo({ left: 0, behavior: 'smooth' });
    // The ellipsis comes back once it is at the start again
    view.setTimeout(() => element.classList.remove('marquee'), 400);
    if (held) swallowNextClick();
  };

  const swallowNextClick = () => {
    const swallow = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    root.addEventListener('click', swallow, { capture: true, once: true });
    // No click came (released off the target): stop waiting for one
    view.setTimeout(() => root.removeEventListener('click', swallow, { capture: true }), 500);
  };

  const onDown = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0) return;
    stop(false);
    const element = (event.target as Element | null)?.closest?.<HTMLElement>('.ellipsis');
    if (!element || !truncated(element)) return;
    pending = {
      element,
      x: event.clientX,
      y: event.clientY,
      timer: view.setTimeout(() => pending && start(pending.element), HOLD_MS),
    };
  };

  const onMove = (event: PointerEvent) => {
    if (pending && Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > SLOP_PX) cancelPending();
  };

  const onUp = () => stop(true);
  const onCancel = () => stop(false);
  // Android's long press would open a context menu over the moving text
  const onContextMenu = (event: Event) => {
    if (pending || running) event.preventDefault();
  };

  root.addEventListener('pointerdown', onDown, true);
  root.addEventListener('pointermove', onMove, true);
  root.addEventListener('pointerup', onUp, true);
  root.addEventListener('pointercancel', onCancel, true);
  root.addEventListener('contextmenu', onContextMenu, true);
  return () => {
    stop(false);
    root.removeEventListener('pointerdown', onDown, true);
    root.removeEventListener('pointermove', onMove, true);
    root.removeEventListener('pointerup', onUp, true);
    root.removeEventListener('pointercancel', onCancel, true);
    root.removeEventListener('contextmenu', onContextMenu, true);
  };
}
