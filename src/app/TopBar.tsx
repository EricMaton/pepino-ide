import { type ReactNode, useContext } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../ui/cx';
import { CommandSearch } from './CommandSearch';
import styles from './TopBar.module.css';
import { type TopBarSlots, TopBarSlotsContext } from './topBarSlots';

/**
 * The app's single top bar: [leading] [command search showing the context] [trailing].
 * Screens fill it from wherever they are with <TopBar>, rendered through a
 * portal into one of two layers: `screen` (explorer, coming-soon pages…) and
 * `overlay` (the editor), which hides the screen layer while it has content.
 * Portals keep frequent updates (the editor re-renders per keystroke) local.
 */
interface TopBarProps {
  layer?: keyof TopBarSlots;
  /** Brand mark, or a ← that leaves the current context. */
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Status or actions on the right (save state…). */
  trailing?: ReactNode;
  /** Id prefix of this context's commands, listed first in the search. */
  prefer?: string;
  /** Accessible name of the search box. */
  label: string;
}

export function TopBar({ layer = 'screen', leading, title, subtitle, trailing, prefer, label }: TopBarProps) {
  const slot = useContext(TopBarSlotsContext)[layer];
  if (!slot) return null;
  return createPortal(
    <div className={styles.row}>
      {leading}
      <CommandSearch label={label} prefer={prefer}>
        <span className={cx('ellipsis', styles.title)}>{title}</span>
        {subtitle && <span className={cx('caption', 'muted', 'ellipsis')}>{subtitle}</span>}
      </CommandSearch>
      {trailing}
    </div>,
    slot,
  );
}

/** The bar itself; App renders it once and provides the slots. */
export function TopBarFrame({
  onScreenSlot,
  onOverlaySlot,
}: {
  onScreenSlot: (element: HTMLElement | null) => void;
  onOverlaySlot: (element: HTMLElement | null) => void;
}) {
  return (
    <header className={styles.bar}>
      <div ref={onScreenSlot} className={styles.screenLayer} />
      <div ref={onOverlaySlot} className={styles.overlayLayer} />
    </header>
  );
}
