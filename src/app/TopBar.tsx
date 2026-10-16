import { type ReactNode, useContext } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../ui/cx';
import { PepinoMark } from '../ui/Logo';
import { CommandSearch, type FileSource } from './CommandSearch';
import styles from './TopBar.module.css';
import { type TopBarSlots, TopBarSlotsContext } from './topBarSlots';

/**
 * The app's single top bar: [logo] [command search showing the context] [trailing].
 * The logo is only the mark: PROJECTS in the bottom nav leads to the explorer.
 * Screens fill it from wherever they are with <TopBar>, rendered through a
 * portal into one of two layers: `screen` (explorer, coming-soon pages…) and
 * `overlay` (the editor), which hides the screen layer while it has content.
 * Portals keep frequent updates (the editor re-renders per keystroke) local.
 */
interface TopBarProps {
  layer?: keyof TopBarSlots;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Status or actions on the right (save state…). */
  trailing?: ReactNode;
  /** Id prefix of this context's commands, listed first in the search. */
  prefer?: string;
  /** Accessible name of the search box. */
  label: string;
  /** Lets the search find files too (inside a project or the editor). */
  files?: FileSource;
}

export function TopBar({ layer = 'screen', title, subtitle, trailing, prefer, label, files }: TopBarProps) {
  const slot = useContext(TopBarSlotsContext)[layer];
  if (!slot) return null;
  return createPortal(
    <div className={styles.row}>
      <span className={styles.mark}>
        <PepinoMark size={40} />
      </span>
      <CommandSearch label={label} prefer={prefer} files={files}>
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
