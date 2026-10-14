import { type ReactNode, useCallback, useEffect, useState } from 'react';
import styles from './components.module.css';
import { cx } from './cx';
import { type ShowSnackbar, SnackbarContext } from './useSnackbar';

const DURATION_MS = 4000;

/** One message at a time, queued in order, like Compose's SnackbarHost. */
export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Array<{ id: number; message: string }>>([]);
  const current = queue[0];

  const show = useCallback<ShowSnackbar>((message) => {
    setQueue((items) => [...items, { id: Date.now() + Math.random(), message }]);
  }, []);

  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => setQueue((items) => items.slice(1)), DURATION_MS);
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
          {current.message}
        </div>
      )}
    </SnackbarContext>
  );
}
