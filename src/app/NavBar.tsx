import { useEffect, useState } from 'react';
import { Dialog } from '../ui/components';
import { cx } from '../ui/cx';
import { BranchIcon, FolderIcon, MoreScreensIcon, PluginIcon, PromptIcon, SlidersIcon } from '../ui/icons';
import { useLongPress } from '../ui/longPress';
import { useSnackbar } from '../ui/useSnackbar';
import styles from './App.module.css';
import { type AppDestination, DESTINATIONS } from './destinations';
import { ALWAYS_PINNED, DEFAULT_PINNED, layoutNav, NAV_PINNED_KEY, parsePinned, pin, unpin } from './navLayout';
import { useServices } from './services';

const NAV_ICONS: Record<AppDestination, typeof FolderIcon> = {
  projects: FolderIcon,
  git: BranchIcon,
  terminal: PromptIcon,
  plugins: PluginIcon,
  settings: SlidersIcon,
};

const label = (id: AppDestination) => DESTINATIONS.find((destination) => destination.id === id)!.label;

/**
 * The bottom bar (#171): the pinned destinations, then ⋯ MORE with the rest.
 * Holding a tab moves it to MORE; holding one in MORE pins it to the bar.
 * SETTINGS always stays. The bar is kept in the preferences.
 */
export function NavBar({
  destination,
  available,
  onSelect,
}: {
  destination: AppDestination;
  /** What this platform has (no TERMINAL on iOS or the web). */
  available: readonly AppDestination[];
  onSelect: (id: AppDestination) => void;
}) {
  const { preferences } = useServices();
  const showSnackbar = useSnackbar();
  const [pinned, setPinned] = useState<readonly AppDestination[]>(DEFAULT_PINNED);
  const [moreOpen, setMoreOpen] = useState(false);
  const known = DESTINATIONS.map((info) => info.id);

  useEffect(() => {
    let active = true;
    preferences.get(NAV_PINNED_KEY).then(
      (raw) => active && setPinned(parsePinned(raw, known)),
      () => undefined,
    );
    return () => {
      active = false;
    };
    // [known] is the app's fixed list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferences]);

  const { bar, more } = layoutNav(available, pinned);

  const save = (next: readonly AppDestination[], message: string, previous: readonly AppDestination[]) => {
    setPinned(next);
    preferences.set(NAV_PINNED_KEY, JSON.stringify(next)).catch(() => undefined);
    showSnackbar(message, {
      label: 'Undo',
      onAction: () => {
        setPinned(previous);
        preferences.set(NAV_PINNED_KEY, JSON.stringify(previous)).catch(() => undefined);
      },
    });
  };

  const holdInBar = (id: AppDestination) => {
    if (ALWAYS_PINNED.includes(id)) {
      showSnackbar(`${label(id)} always stays in the bar`);
      return;
    }
    save(unpin(bar, id), `${label(id)} moved to More`, bar);
  };

  const holdInMore = (id: AppDestination) => {
    const next = pin(bar, id, available);
    if (!next) {
      showSnackbar('The bar is full: hold one of its tabs to move it to More first');
      return;
    }
    setMoreOpen(false);
    save(next, `${label(id)} pinned to the bar`, bar);
  };

  return (
    <nav className={styles.nav}>
      {bar.map((id) => (
        <NavButton
          key={id}
          id={id}
          current={id === destination}
          onTap={() => onSelect(id)}
          onHold={() => holdInBar(id)}
        />
      ))}
      {more.length > 0 && (
        <button
          type="button"
          className={styles.navItem}
          aria-current={more.includes(destination) ? 'page' : undefined}
          aria-haspopup="dialog"
          onClick={() => setMoreOpen(true)}
        >
          <MoreScreensIcon size={22} />
          <span className="label">{more.includes(destination) ? label(destination) : 'MORE'}</span>
        </button>
      )}
      {moreOpen && (
        <Dialog title="More" eyebrow="HOLD ONE TO PIN IT TO THE BAR" onClose={() => setMoreOpen(false)}>
          <div className={styles.moreList}>
            {more.map((id) => (
              <MoreItem
                key={id}
                id={id}
                current={id === destination}
                onTap={() => {
                  setMoreOpen(false);
                  onSelect(id);
                }}
                onHold={() => holdInMore(id)}
              />
            ))}
          </div>
        </Dialog>
      )}
    </nav>
  );
}

function NavButton({
  id,
  current,
  onTap,
  onHold,
}: {
  id: AppDestination;
  current: boolean;
  onTap: () => void;
  onHold: () => void;
}) {
  const press = useLongPress(onHold, onTap);
  const Icon = NAV_ICONS[id];
  return (
    <button type="button" className={styles.navItem} aria-current={current ? 'page' : undefined} {...press}>
      <Icon size={22} />
      <span className="label">{label(id)}</span>
    </button>
  );
}

function MoreItem({
  id,
  current,
  onTap,
  onHold,
}: {
  id: AppDestination;
  current: boolean;
  onTap: () => void;
  onHold: () => void;
}) {
  const press = useLongPress(onHold, onTap);
  const Icon = NAV_ICONS[id];
  const info = DESTINATIONS.find((destination) => destination.id === id)!;
  return (
    <button
      type="button"
      className={cx(styles.moreItem, current && styles.moreItemCurrent)}
      aria-current={current ? 'page' : undefined}
      {...press}
    >
      <Icon size={24} />
      <span className={styles.moreText}>
        <span className="label">{info.label}</span>
        <span className="caption muted">{info.description}</span>
      </span>
    </button>
  );
}
