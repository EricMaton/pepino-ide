import { useEffect, useRef } from 'react';

/*
 * Back navigation as a stack: the most recently registered handler wins.
 * Dialogs register while open, the explorer while it can go up, so the
 * Android back button always undoes the innermost thing first.
 */
const handlers: Array<() => void> = [];

/** Runs the topmost back handler. Returns false when nothing consumed it. */
export function dispatchBack(): boolean {
  const top = handlers[handlers.length - 1];
  if (!top) return false;
  top();
  return true;
}

export function useBackHandler(enabled: boolean, handler: () => void): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    if (!enabled) return;
    const entry = () => latest.current();
    handlers.push(entry);
    return () => {
      handlers.splice(handlers.lastIndexOf(entry), 1);
    };
  }, [enabled]);
}
