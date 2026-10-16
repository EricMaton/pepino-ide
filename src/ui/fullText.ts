/*
 * Text cut short (the `.ellipsis` class, everywhere in the app) can be read
 * whole: hold it and a bubble shows the full text above the finger, wrapped
 * on as many lines as it needs; let go and it goes. Holding a row (a file,
 * a repository, a commit) shows every text of it that is cut. One listener
 * on the document does it for every `.ellipsis`, present or future. Text
 * that fits does nothing, a finger that moves (a scroll) cancels it, and the
 * tap that ends a hold does not go through: holding a file's name to read it
 * never opens it.
 */

/** How long a finger stays down before the bubble shows. */
export const HOLD_MS = 450;
/** How far a finger may move and still be holding (more is a scroll). */
const SLOP_PX = 10;
/** The bubble's gap to the screen edges and to the text. */
const MARGIN_PX = 12;
const GAP_PX = 10;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Where the bubble goes for text at [target]: above it, centred on it and
 * kept on screen; below when there is no room above. [arrow] is the arrow's
 * x inside the bubble, pointing at the text's centre.
 */
export function bubblePlacement(
  target: Rect,
  bubble: { width: number; height: number },
  viewport: { width: number; height: number },
): { top: number; left: number; below: boolean; arrow: number } {
  const centre = target.left + target.width / 2;
  const maxLeft = Math.max(MARGIN_PX, viewport.width - MARGIN_PX - bubble.width);
  const left = Math.min(Math.max(centre - bubble.width / 2, MARGIN_PX), maxLeft);
  const below = target.top - GAP_PX - bubble.height < MARGIN_PX;
  const top = below ? target.top + target.height + GAP_PX : target.top - GAP_PX - bubble.height;
  const arrow = Math.min(Math.max(centre - left, 16), bubble.width - 16);
  return { top, left, below, arrow };
}

/** Whether [element] cuts its text short. */
const cut = (element: HTMLElement) => element.scrollWidth - element.clientWidth > 1;

/** What a press on [target] would show: its own text if cut, else every cut text of the item pressed. */
export function cutTexts(target: Element | null): { anchor: HTMLElement; texts: string[] } | null {
  const own = target?.closest<HTMLElement>('.ellipsis');
  if (own && cut(own)) return { anchor: own, texts: [own.textContent ?? ''] };
  const item = target?.closest<HTMLElement>('button, a, [role="option"], [role="tab"], li, label');
  if (!item) return null;
  const inside = [...item.querySelectorAll<HTMLElement>('.ellipsis')].filter(cut);
  if (inside.length === 0) return null;
  return { anchor: inside[0], texts: inside.map((element) => element.textContent ?? '') };
}

/** Starts listening on [root]; returns the stop. */
export function installFullText(root: Document = document): () => void {
  const view = root.defaultView ?? window;
  let pending: { x: number; y: number; timer: number } | null = null;
  let bubble: HTMLElement | null = null;

  const cancelPending = () => {
    if (pending) view.clearTimeout(pending.timer);
    pending = null;
  };

  const show = (found: { anchor: HTMLElement; texts: string[] }) => {
    pending = null;
    const element = root.createElement('div');
    element.className = 'fullText';
    element.setAttribute('role', 'tooltip');
    for (const text of found.texts) {
      const line = root.createElement('p');
      line.textContent = text;
      element.append(line);
    }
    // Above dialogs too (they live in the top layer): a popover does, where it exists
    const popover = typeof element.showPopover === 'function';
    if (popover) element.setAttribute('popover', 'manual');
    (found.anchor.closest('dialog[open]') && !popover ? found.anchor.closest('dialog')! : root.body).append(element);
    if (popover) element.showPopover();
    const place = bubblePlacement(
      found.anchor.getBoundingClientRect(),
      { width: element.offsetWidth, height: element.offsetHeight },
      { width: view.innerWidth, height: view.innerHeight },
    );
    element.style.top = `${place.top}px`;
    element.style.left = `${place.left}px`;
    element.style.setProperty('--arrow', `${place.arrow}px`);
    element.classList.toggle('below', place.below);
    bubble = element;
  };

  /** Ends a hold; [held] when the bubble showed, so the tap ending it must not go through. */
  const hide = (held: boolean) => {
    cancelPending();
    if (!bubble) return;
    bubble.remove();
    bubble = null;
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
    hide(false);
    const found = cutTexts(event.target as Element | null);
    if (!found) return;
    pending = { x: event.clientX, y: event.clientY, timer: view.setTimeout(() => show(found), HOLD_MS) };
  };

  const onMove = (event: PointerEvent) => {
    if (pending && Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > SLOP_PX) cancelPending();
  };

  const onUp = () => hide(true);
  const onCancel = () => hide(false);
  // Android's long press would open a context menu over the bubble
  const onContextMenu = (event: Event) => {
    if (pending || bubble) event.preventDefault();
  };

  root.addEventListener('pointerdown', onDown, true);
  root.addEventListener('pointermove', onMove, true);
  root.addEventListener('pointerup', onUp, true);
  root.addEventListener('pointercancel', onCancel, true);
  root.addEventListener('contextmenu', onContextMenu, true);
  return () => {
    hide(false);
    root.removeEventListener('pointerdown', onDown, true);
    root.removeEventListener('pointermove', onMove, true);
    root.removeEventListener('pointerup', onUp, true);
    root.removeEventListener('pointercancel', onCancel, true);
    root.removeEventListener('contextmenu', onContextMenu, true);
  };
}
