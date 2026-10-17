import { type ReactNode, useCallback, useEffect, useState } from 'react';
import styles from './components.module.css';
import { cx } from './cx';
import { type ShowSnackbar, type SnackbarAction, SnackbarContext } from './useSnackbar';

const DURATION_MS = 4000;
/** With an action, longer: time to read it and reach the button. */
const ACTION_DURATION_MS = 8000;

/** One message at a time, queued in order, like Compose's SnackbarHost. */
export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Array<{ id: number; message: string; action?: SnackbarAction }>>([]);
  const current = queue[0];

  const show = useCallback<ShowSnackbar>((message, action) => {
    setQueue((items) => [...items, { id: Date.now() + Math.random(), message, action }]);
  }, []);

  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(
      () => setQueue((items) => items.slice(1)),
      current.action ? ACTION_DURATION_MS : DURATION_MS,
    );
    return () => clearTimeout(timer);
  }, [current]);

  return (
    <SnackbarContext value={show}>
      {children}
      {current && (
        <div
          key={current.id}
          role="status"
          className={cx('label', styles.snackbar)}
          onClick={() => setQueue((items) => items.slice(1))}
        >
          <span className={styles.snackbarText}>{current.message}</span>
          {current.action && (
            <button
              type="button"
              className={cx('label', styles.snackbarAction)}
              onClick={(event) => {
                event.stopPropagation();
                setQueue((items) => items.slice(1));
                current.action!.onAction();
              }}
            >
              {current.action.label}
            </button>
          )}
        </div>
      )}
    </SnackbarContext>
  );
}
