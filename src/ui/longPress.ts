import { useRef } from 'react';

/** How long a finger stays down to make a hold, not a tap. */
const HOLD_MS = 500;

/**
 * A tap runs [onTap]; holding [HOLD_MS] runs [onHold] instead (and the tap
 * that ends the hold does nothing). Moving the finger away cancels the hold.
 * The system's long-press menu (text selection, context menu) is kept out.
 */
export function useLongPress(onHold: () => void, onTap: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const held = useRef(false);
  const cancel = () => clearTimeout(timer.current);
  return {
    onPointerDown: () => {
      held.current = false;
      cancel();
      timer.current = setTimeout(() => {
        held.current = true;
        onHold();
      }, HOLD_MS);
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (event: { preventDefault: () => void }) => event.preventDefault(),
    onClick: () => {
      if (held.current) {
        held.current = false;
        return;
      }
      onTap();
    },
  };
}
