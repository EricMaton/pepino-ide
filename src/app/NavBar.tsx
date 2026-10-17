import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { useBackHandler } from '../ui/back';
import { cx } from '../ui/cx';
import { BranchIcon, FolderIcon, MoreScreensIcon, PluginIcon, PromptIcon, SlidersIcon } from '../ui/icons';
import { useSnackbar } from '../ui/useSnackbar';
import styles from './App.module.css';
import { type AppDestination, DESTINATIONS } from './destinations';
import {
  DEFAULT_ORDER,
  layoutNav,
  moveDestination,
  type NavDrop,
  NAV_ORDER_KEY,
  type NavOrder,
  parseNavOrder,
} from './navLayout';
import { useServices } from './services';

const NAV_ICONS: Record<AppDestination, typeof FolderIcon> = {
  projects: FolderIcon,
  git: BranchIcon,
  terminal: PromptIcon,
  plugins: PluginIcon,
  settings: SlidersIcon,
};

const label = (id: AppDestination) => DESTINATIONS.find((destination) => destination.id === id)!.label;

/** How long a finger stays still on a destination before it can be dragged. */
const HOLD_MS = 350;
/** Moving further than this before then is a scroll or a slip, not a hold. */
const SLOP_PX = 10;

interface Drag {
  id: AppDestination;
  pointer: number;
  x: number;
  y: number;
  /** Where it would land now; null over nothing. */
  target: NavDrop | null;
}

/**
 * The bottom bar (#171): the destinations in the bar, then ⋯ MORE, whose
 * tray rises above the bar with the rest. Holding a destination picks it
 * up: dragged along the bar it moves there, into the tray it goes to MORE,
 * from the tray into the bar it is pinned (into a full bar, swapping with
 * the one it lands next to). SETTINGS stays in the bar. Kept in the
 * preferences.
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
  const [order, setOrder] = useState<NavOrder>(DEFAULT_ORDER);
  const [trayOpen, setTrayOpen] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  // A press in progress: where it started, and its hold timer
  const press = useRef<{ id: AppDestination; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  // The click that ends a drag is not a tap
  const dragged = useRef(false);

  useEffect(() => {
    let active = true;
    preferences.get(NAV_ORDER_KEY).then(
      (raw) =>
        active &&
        setOrder(
          parseNavOrder(
            raw,
            DESTINATIONS.map((info) => info.id),
          ),
        ),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [preferences]);

  useBackHandler(trayOpen && !drag, () => setTrayOpen(false));

  const { bar, more } = layoutNav(available, order);
  // While dragging, the tray is open to drop into, even empty
  const showTray = trayOpen || drag !== null;

  const save = (next: NavOrder) => {
    setOrder(next);
    preferences.set(NAV_ORDER_KEY, JSON.stringify(next)).catch(() => undefined);
  };

  /** Where the finger at (x, y) would drop: before an item (or after, past its middle), or at a zone's end. */
  const targetAt = (x: number, y: number, id: AppDestination): NavDrop | null => {
    const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-nav-zone]');
    if (!element) return null;
    const zone = element.dataset.navZone as NavDrop['zone'];
    const list = (zone === 'bar' ? bar : more).filter((other) => other !== id);
    const over = element.dataset.navId as AppDestination | undefined;
    if (!over || over === id) {
      // Over the zone itself (or the dragged item's own spot): its end, or where it was
      const own = (zone === 'bar' ? bar : more).indexOf(id);
      return { zone, index: over === id && own >= 0 ? own : list.length };
    }
    const box = element.getBoundingClientRect();
    const index = list.indexOf(over) + (x > box.left + box.width / 2 ? 1 : 0);
    return { zone, index };
  };

  const onPointerDown = (id: AppDestination) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    dragged.current = false;
    const target = event.currentTarget;
    const pointer = event.pointerId;
    const { clientX: x, clientY: y } = event;
    clearTimeout(press.current?.timer);
    press.current = {
      id,
      x,
      y,
      timer: setTimeout(() => {
        // Held: picked up
        dragged.current = true;
        target.setPointerCapture?.(pointer);
        navigator.vibrate?.(15);
        setDrag({ id, pointer, x, y, target: null });
      }, HOLD_MS),
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const pressed = press.current;
    if (!drag) {
      if (pressed && Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > SLOP_PX) {
        clearTimeout(pressed.timer);
        press.current = null;
      }
      return;
    }
    if (event.pointerId !== drag.pointer) return;
    setDrag({
      ...drag,
      x: event.clientX,
      y: event.clientY,
      target: targetAt(event.clientX, event.clientY, drag.id),
    });
  };

  const onPointerEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    clearTimeout(press.current?.timer);
    press.current = null;
    if (!drag) return;
    const { id } = drag;
    // Where the finger lifts decides, not the last move seen (a quick drag skips some)
    const target =
      event.type === 'pointerup' ? (targetAt(event.clientX, event.clientY, id) ?? drag.target) : drag.target;
    setDrag(null);
    if (!target) return;
    const result = moveDestination(available, order, id, target);
    if ('refused' in result) {
      showSnackbar(`${label(id)} always stays in the bar`);
      return;
    }
    if (JSON.stringify(result.order) === JSON.stringify(order)) return;
    const previous = order;
    save(result.order);
    const inBar = result.order.bar.includes(id);
    const message = result.displaced
      ? `${label(id)} in the bar · ${label(result.displaced)} moved to More`
      : inBar && bar.includes(id)
        ? `${label(id)} moved`
        : inBar
          ? `${label(id)} pinned to the bar`
          : `${label(id)} moved to More`;
    showSnackbar(message, { label: 'Undo', onAction: () => save(previous) });
  };

  const tap = (id: AppDestination) => () => {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    setTrayOpen(false);
    onSelect(id);
  };

  /** One destination, in the bar or the tray; with the drop marker when the dragged one would land here. */
  const item = (id: AppDestination, zone: NavDrop['zone']) => {
    const list = (zone === 'bar' ? bar : more).filter((other) => other !== drag?.id);
    const at = list.indexOf(id);
    const marker =
      drag && drag.target?.zone === zone && id !== drag.id
        ? drag.target.index === at
          ? styles.dropBefore
          : drag.target.index === list.length && at === list.length - 1
            ? styles.dropAfter
            : undefined
        : undefined;
    const Icon = NAV_ICONS[id];
    return (
      <button
        key={id}
        type="button"
        className={cx(zone === 'bar' ? styles.navItem : styles.trayItem, drag?.id === id && styles.navPicked, marker)}
        aria-current={id === destination ? 'page' : undefined}
        data-nav-zone={zone}
        data-nav-id={id}
        onPointerDown={onPointerDown(id)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onContextMenu={(event) => event.preventDefault()}
        onClick={tap(id)}
      >
        <Icon size={22} />
        <span className="label">{label(id)}</span>
      </button>
    );
  };

  return (
    <nav className={styles.nav}>
      {showTray && (
        <>
          {!drag && <div className={styles.trayCatcher} onClick={() => setTrayOpen(false)} aria-hidden />}
          <div className={styles.tray} data-nav-zone="more" role="group" aria-label="More">
            <span className={cx('caption', 'muted', styles.trayHint)}>
              {drag ? 'Drop here to move it to More' : 'Hold one and drag it to arrange the bar'}
            </span>
            <div className={styles.trayItems} data-nav-zone="more">
              {more.map((id) => item(id, 'more'))}
            </div>
          </div>
        </>
      )}
      <div className={styles.navBar} data-nav-zone="bar">
        {bar.map((id) => item(id, 'bar'))}
        {more.length > 0 && (
          <button
            type="button"
            className={styles.navItem}
            aria-current={more.includes(destination) || trayOpen ? 'page' : undefined}
            aria-expanded={trayOpen}
            onClick={() => setTrayOpen((open) => !open)}
          >
            <MoreScreensIcon size={22} />
            <span className="label">{more.includes(destination) ? label(destination) : 'MORE'}</span>
          </button>
        )}
      </div>
      {drag && (
        <div className={styles.navGhost} style={{ left: drag.x, top: drag.y }} aria-hidden>
          {(() => {
            const Icon = NAV_ICONS[drag.id];
            return <Icon size={22} />;
          })()}
          <span className="label">{label(drag.id)}</span>
        </div>
      )}
    </nav>
  );
}
