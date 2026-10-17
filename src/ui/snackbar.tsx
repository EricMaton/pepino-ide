import { type PointerEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import styles from './components.module.css';
import { cx } from './cx';
import { CloseIcon } from './icons';
import { type ShowSnackbar, type SnackbarAction, SnackbarContext } from './useSnackbar';

const DURATION_MS = 4000;
/** With an action, longer: time to read it and reach the button. */
const ACTION_DURATION_MS = 8000;
/** Dragged down this far (px), or flicked down this fast (px/ms), it goes (#173). */
const DISMISS_DISTANCE = 40;
const DISMISS_SPEED = 0.5;
/** A press that moves less than this is a tap. */
const TAP_SLOP = 6;
/** How long it takes to slide away once let go. */
const LEAVE_MS = 160;

/** One message at a time, queued in order, like Compose's SnackbarHost. */
export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Array<{ id: number; message: string; action?: SnackbarAction }>>([]);
  const current = queue[0];
  // Swiping it away (#173): how far down it is, and whether it is on its way out
  const [offset, setOffset] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [held, setHeld] = useState(false);
  const swipe = useRef<{ pointer: number; startY: number; lastY: number; lastTime: number; speed: number } | null>(
    null,
  );
  const moved = useRef(false);

  const show = useCallback<ShowSnackbar>((message, action) => {
    setQueue((items) => [...items, { id: Date.now() + Math.random(), message, action }]);
  }, []);

  const dismiss = useCallback(() => {
    setQueue((items) => items.slice(1));
    setOffset(0);
    setLeaving(false);
    setHeld(false);
  }, []);

  /** Slides down and out, then the next one comes. */
  const leave = useCallback(() => {
    setLeaving(true);
    setTimeout(dismiss, LEAVE_MS);
  }, [dismiss]);

  // It stays while a finger holds it
  useEffect(() => {
    if (!current || held || leaving) return;
    const timer = setTimeout(dismiss, current.action ? ACTION_DURATION_MS : DURATION_MS);
    return () => clearTimeout(timer);
  }, [current, held, leaving, dismiss]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    moved.current = false;
    swipe.current = {
      pointer: event.pointerId,
      startY: event.clientY,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      speed: 0,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setHeld(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = swipe.current;
    if (!drag || event.pointerId !== drag.pointer) return;
    const elapsed = Math.max(1, event.timeStamp - drag.lastTime);
    drag.speed = (event.clientY - drag.lastY) / elapsed;
    drag.lastY = event.clientY;
    drag.lastTime = event.timeStamp;
    const distance = event.clientY - drag.startY;
    if (Math.abs(distance) > TAP_SLOP) moved.current = true;
    // Down it follows the finger; up it barely gives
    setOffset(distance > 0 ? distance : distance / 6);
  };

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    const drag = swipe.current;
    if (!drag || event.pointerId !== drag.pointer) return;
    swipe.current = null;
    setHeld(false);
    const distance = event.clientY - drag.startY;
    if (moved.current && (distance > DISMISS_DISTANCE || drag.speed > DISMISS_SPEED)) leave();
    else setOffset(0);
  };

  return (
    <SnackbarContext value={show}>
      {children}
      {current && (
        <div
          key={current.id}
          role="status"
          className={cx('label', styles.snackbar, held && styles.snackbarHeld, leaving && styles.snackbarLeaving)}
          style={leaving ? undefined : offset !== 0 ? { transform: `translateY(${offset}px)` } : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onClick={() => {
            // A tap still closes it; the end of a swipe is not a tap
            if (!moved.current) dismiss();
          }}
        >
          <span className={styles.snackbarText}>{current.message}</span>
          {current.action && (
            <button
              type="button"
              className={cx('label', styles.snackbarAction)}
              onClick={(event) => {
                event.stopPropagation();
                dismiss();
                current.action!.onAction();
              }}
            >
              {current.action.label}
            </button>
          )}
          <button
            type="button"
            className={styles.snackbarClose}
            aria-label="Close"
            onClick={(event) => {
              event.stopPropagation();
              leave();
            }}
          >
            <CloseIcon size={18} />
          </button>
        </div>
      )}
    </SnackbarContext>
  );
}
