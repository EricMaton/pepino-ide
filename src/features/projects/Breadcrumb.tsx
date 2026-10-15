import { type ReactNode, useEffect, useRef } from 'react';
import { cx } from '../../ui/cx';
import styles from './FileExplorer.module.css';
import { basename } from './paths';

/** `~/projects / src / ui` — every segment is a jump target; keeps the deepest one in view. */
export function Breadcrumb({
  stack,
  rootLabel,
  onJump,
}: {
  stack: string[];
  rootLabel: ReactNode;
  onJump: (depth: number) => void;
}) {
  const scrollRef = useRef<HTMLElement>(null);
  // A "/" root is its own separator: "/ src / ui", never "/ / src".
  const rootIsSlash = rootLabel === '/';
  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;
  }, [stack]);

  return (
    <nav ref={scrollRef} className={styles.breadcrumb} aria-label="Location">
      {stack.map((path, depth) => {
        const last = depth === stack.length - 1;
        return (
          <span key={path} className={styles.crumb}>
            {(depth > 1 || (depth === 1 && !rootIsSlash)) && (
              <span className="muted" aria-hidden>
                /
              </span>
            )}
            <button
              type="button"
              className={cx('body', styles.crumbButton, last && styles.crumbCurrent)}
              aria-current={last ? 'location' : undefined}
              disabled={last}
              onClick={() => onJump(depth)}
            >
              {depth === 0 ? rootLabel : basename(path)}
            </button>
          </span>
        );
      })}
    </nav>
  );
}
