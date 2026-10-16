import { flushSync } from 'react-dom';

/*
 * Where a screen change goes, so the motion tells it (styles in global.css):
 * - forward / back: deeper into or out of something (a folder, a file);
 * - rise / sink: into and out of the workspace, which lives in the explorer's
 *   bottom strip while the explorer shows;
 * - drawer: the workspace's file tree sliding over the editor, and away;
 * - dismiss: something closes where it stands (the active project, from its
 *   strip): only that goes, the screen around it stays still.
 * Switching tabs does not move: it happens tens of times a day, and tabs sit
 * side by side, so a slide would suggest a depth that is not there.
 */
export type NavDirection = 'forward' | 'back' | 'rise' | 'sink' | 'drawer' | 'dismiss';

/** The longest a transition waits for the new screen's content (folder listing, file) before moving. */
const SETTLE_LIMIT_MS = 150;

// A timer, not requestAnimationFrame: rendering is paused while a view transition updates the DOM.
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 16));

/** Resolves once nothing on screen is still loading ([data-loading]), or after [SETTLE_LIMIT_MS]. */
async function settled(): Promise<void> {
  const start = performance.now();
  while (document.querySelector('[data-loading]') && performance.now() - start < SETTLE_LIMIT_MS) {
    await tick();
  }
}

/**
 * Runs [update] (React state changes) as a view transition moving in
 * [direction]: the old screen stays up until the new one has its content,
 * then they move. With reduced motion the CSS keeps only a short fade;
 * without the View Transitions API the change is simply instant.
 */
export function navigate(direction: NavDirection, update: () => void): void {
  if (!('startViewTransition' in document)) {
    update();
    return;
  }
  const root = document.documentElement;
  root.dataset.nav = direction;
  const transition = document.startViewTransition(async () => {
    flushSync(update);
    await settled();
  });
  transition.updateCallbackDone.catch((error: unknown) => console.error('Screen change failed', error));
  void transition.finished
    .catch(() => undefined)
    .then(() => {
      if (root.dataset.nav === direction) delete root.dataset.nav;
    });
}
