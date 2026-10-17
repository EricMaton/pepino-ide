import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef, useState } from 'react';
import { TopBar } from '../../app/TopBar';
import { useServices } from '../../app/services';
import { Button } from '../../ui/components';
import { cx } from '../../ui/cx';
import { THEME_EVENT } from '../../ui/theme';
import { errorMessage } from '../projects/errors';
import { resolveInRoot } from '../projects/paths';
import type { ProjectInfo } from '../projects/projects';
import { keySequence, TERMINAL_KEYS, withControl } from './keys';
import styles from './TerminalScreen.module.css';
import type { TerminalBackend } from './terminal';

/*
 * TERMINAL (#39, ADR-004): xterm.js on a shell in the active project. The
 * screen stays mounted while other tabs show, so the scrollback stays; the
 * shell belongs to the native plugin, so it outlives even the page, and a
 * page that loads again attaches to it, showing what it printed last.
 */

/** ANSI's colours as they read on a dark ground, and on a light one (#44). */
const ANSI = {
  dark: {
    black: '#1a1a1a',
    red: '#e10600',
    green: '#3fd46b',
    yellow: '#f2b33d',
    blue: '#5b9cf5',
    magenta: '#d27af0',
    cyan: '#4fd6d0',
    white: '#d8d8d2',
    brightBlack: '#6a6a66',
    brightRed: '#ff5a50',
    brightGreen: '#7ae896',
    brightYellow: '#ffd27a',
    brightBlue: '#8ebcff',
    brightMagenta: '#e7a6ff',
    brightCyan: '#8af0ea',
    brightWhite: '#ffffff',
  },
  light: {
    black: '#0a0a0a',
    red: '#c20400',
    green: '#1b8a40',
    yellow: '#a36600',
    blue: '#1f5fc4',
    magenta: '#8e3fb5',
    cyan: '#08808a',
    white: '#6c6962',
    brightBlack: '#4a4843',
    brightRed: '#e10600',
    brightGreen: '#23a24c',
    brightYellow: '#c27a00',
    brightBlue: '#2f7cf6',
    brightMagenta: '#a64fd0',
    brightCyan: '#0a9aa6',
    brightWhite: '#2a2a2a',
  },
};

/** xterm's colours: the app's tokens for the ground and the cursor, the theme's base's ANSI palette. */
function theme() {
  const root = document.documentElement;
  const css = getComputedStyle(root);
  const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const primary = token('--primary', '#e10600');
  return {
    ...ANSI[root.dataset.theme === 'light' ? 'light' : 'dark'],
    background: token('--bg', '#0a0a0a'),
    foreground: token('--fg', '#f2f2f2'),
    cursor: primary,
    cursorAccent: token('--bg', '#0a0a0a'),
    // xterm takes plain colours: the accent's #rrggbb with an alpha
    selectionBackground: /^#[0-9a-f]{6}$/i.test(primary) ? `${primary}59` : '#e1060059',
  };
}

const FONT_SIZE = 13;

export default function TerminalScreen({ project, visible }: { project: ProjectInfo | null; visible: boolean }) {
  const { terminal } = useServices();
  const subtitle = !terminal.available ? 'ANDROID ONLY' : `${project ? project.name : '~projects'} · sh`;
  return (
    <div className={styles.screen} hidden={!visible}>
      {visible && <TopBar title="Terminal" subtitle={subtitle} label="Search commands · Terminal" />}
      {!terminal.available ? (
        <Note title="The terminal runs on Android">
          iOS lets no app start programs, and the browser has no shell. Everything else in Pepino works the same.
        </Note>
      ) : (
        // In the open project; with none, in the projects' folder (#161)
        <TerminalView key={project?.path ?? ''} backend={terminal} path={project?.path ?? ''} visible={visible} />
      )}
    </div>
  );
}

function Note({ title, children }: { title: string; children: string }) {
  return (
    <div className={styles.note}>
      <span className="label accent">// Terminal</span>
      <p className="title">{title}</p>
      <p className="caption muted">{children}</p>
    </div>
  );
}

/**
 * xterm.js on the shell of project [path]: the running one when there is
 * (attached with what it printed last), else a new one. Typing goes to the
 * shell, its output to xterm; the size follows the screen (the keyboard
 * opening and closing too).
 */
function TerminalView({ backend, path, visible }: { backend: TerminalBackend; path: string; visible: boolean }) {
  const holder = useRef<HTMLDivElement>(null);
  // The xterm and its shell, once both exist; [ended] with the shell's exit code
  const view = useRef<{ term: Terminal; fit: FitAddon; id: number | null } | null>(null);
  const [ended, setEnded] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  // Ctrl from the row of keys (#40): sticky until the next key; the ref is what typing reads
  const [ctrl, setCtrl] = useState(false);
  const ctrlHeld = useRef(false);
  const holdCtrl = (held: boolean) => {
    ctrlHeld.current = held;
    setCtrl(held);
  };

  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    const term = new Terminal({
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'monospace',
      fontSize: FONT_SIZE,
      theme: theme(),
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(element);
    const current = { term, fit, id: null as number | null };
    view.current = current;
    let active = true;
    // Output that comes while attaching (a new shell's prompt can come before its id) waits, so none
    // is shown twice or lost; [shownUpTo] is where what xterm shows ends in all the shell printed
    let attached = false;
    let shownUpTo = 0;
    const waiting: { id: number; data: string; end: number }[] = [];
    const show = (data: string, end: number) => {
      if (end <= shownUpTo) return;
      term.write(data);
      shownUpTo = end;
    };
    const stopData = backend.onData((id, data, end) => {
      if (!attached) waiting.push({ id, data, end });
      else if (id === current.id) show(data, end);
    });
    const stopExit = backend.onExit((id, code) => {
      if (id !== current.id) return;
      current.id = null;
      term.write(`\r\n\x1b[2m[The shell ended: exit code ${code}]\x1b[0m\r\n`);
      setEnded(code);
    });
    // A theme chosen in SETTINGS (#44) recolours the terminal as it is
    const recolour = () => {
      term.options.theme = theme();
    };
    window.addEventListener(THEME_EVENT, recolour);
    const typing = term.onData((typed) => {
      if (current.id === null) return;
      let data = typed;
      // Ctrl held from the row: the key typed now goes as its control code
      if (ctrlHeld.current) {
        data = withControl(typed);
        ctrlHeld.current = false;
        setCtrl(false);
      }
      void backend.write(current.id, data);
    });

    (async () => {
      try {
        if (element.clientWidth > 0) fit.fit();
        const folder = resolveInRoot(path);
        const running = (await backend.sessions()).find((session) => session.cwd === folder);
        if (running) {
          current.id = running.id;
          const history = await backend.history(running.id);
          if (!active) return;
          term.write(history.data);
          shownUpTo = history.end;
          await backend.resize(running.id, term.cols, term.rows);
        } else {
          current.id = await backend.spawn({ cwd: path, cols: term.cols, rows: term.rows });
        }
        if (!active) return;
        attached = true;
        for (const chunk of waiting.splice(0)) if (chunk.id === current.id) show(chunk.data, chunk.end);
      } catch (failure) {
        if (active) setError(errorMessage(failure));
      }
    })();

    return () => {
      active = false;
      stopData();
      stopExit();
      typing.dispose();
      window.removeEventListener(THEME_EVENT, recolour);
      term.dispose();
      view.current = null;
    };
  }, [backend, path, generation]);

  // The size follows the holder: the screen turning, the keyboard opening or closing. The keyboard
  // resizes the window over an animation, so the window's and the visible viewport's resizes refit
  // too, and again once it has settled. Output followed to the end stays at the end (#161).
  useEffect(() => {
    const element = holder.current;
    if (!element || !visible) return;
    const refit = () => {
      const current = view.current;
      if (!current || element.clientWidth === 0 || element.clientHeight === 0) return;
      const { term } = current;
      const { cols, rows } = term;
      const atEnd = term.buffer.active.viewportY >= term.buffer.active.baseY;
      current.fit.fit();
      if (term.cols === cols && term.rows === rows) return;
      if (atEnd) term.scrollToBottom();
      if (current.id !== null) void backend.resize(current.id, term.cols, term.rows);
    };
    const timers: ReturnType<typeof setTimeout>[] = [];
    const settle = () => {
      refit();
      timers.splice(0).forEach(clearTimeout);
      for (const delay of [80, 250, 500]) timers.push(setTimeout(refit, delay));
    };
    const observer = new ResizeObserver(refit);
    observer.observe(element);
    window.addEventListener('resize', settle);
    window.visualViewport?.addEventListener('resize', settle);
    refit();
    view.current?.term.focus();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', settle);
      window.visualViewport?.removeEventListener('resize', settle);
      timers.forEach(clearTimeout);
    };
  }, [backend, visible, generation]);

  // Scrolling the history with a finger (#161): xterm 6 scrolls with the wheel only. A drag moves
  // it a line at a time, and keeps going for a moment after letting go, slowing down.
  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    let lastY: number | null = null;
    let lastTime = 0;
    let carried = 0;
    let velocity = 0;
    let frame = 0;
    const rowHeight = () => {
      const term = view.current?.term;
      const screen = term?.element?.querySelector('.xterm-screen');
      return term && screen ? screen.clientHeight / term.rows : 16;
    };
    // [pixels] of finger travel (up is positive) as lines scrolled; the rest carries over
    const scrollBy = (pixels: number) => {
      const term = view.current?.term;
      if (!term) return;
      carried += pixels;
      const lines = Math.trunc(carried / rowHeight());
      if (lines !== 0) {
        term.scrollLines(lines);
        carried -= lines * rowHeight();
      }
    };
    const start = (event: TouchEvent) => {
      cancelAnimationFrame(frame);
      if (event.touches.length !== 1) return;
      lastY = event.touches[0].clientY;
      lastTime = event.timeStamp;
      carried = 0;
      velocity = 0;
    };
    const move = (event: TouchEvent) => {
      if (lastY === null || event.touches.length !== 1) return;
      const y = event.touches[0].clientY;
      const elapsed = Math.max(1, event.timeStamp - lastTime);
      velocity = (lastY - y) / elapsed;
      scrollBy(lastY - y);
      lastY = y;
      lastTime = event.timeStamp;
      // The page itself must not move instead
      event.preventDefault();
      event.stopPropagation();
    };
    const end = () => {
      if (lastY === null) return;
      lastY = null;
      let previous = performance.now();
      const glide = (now: number) => {
        const elapsed = now - previous;
        previous = now;
        velocity *= Math.pow(0.995, elapsed);
        if (Math.abs(velocity) < 0.02) return;
        scrollBy(velocity * elapsed);
        frame = requestAnimationFrame(glide);
      };
      frame = requestAnimationFrame(glide);
    };
    element.addEventListener('touchstart', start, { capture: true, passive: true });
    element.addEventListener('touchmove', move, { capture: true, passive: false });
    element.addEventListener('touchend', end, { capture: true });
    element.addEventListener('touchcancel', end, { capture: true });
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener('touchstart', start, { capture: true });
      element.removeEventListener('touchmove', move, { capture: true });
      element.removeEventListener('touchend', end, { capture: true });
      element.removeEventListener('touchcancel', end, { capture: true });
    };
  }, [generation]);

  const press = (id: string) => {
    const current = view.current;
    if (id === 'ctrl') {
      holdCtrl(!ctrlHeld.current);
      return;
    }
    const sequence = keySequence(id, {
      ctrl: ctrlHeld.current,
      applicationCursor: current?.term.modes.applicationCursorKeysMode ?? false,
    });
    holdCtrl(false);
    if (current && current.id !== null && sequence) void backend.write(current.id, sequence);
  };

  const restart = () => {
    setEnded(null);
    setError(null);
    setGeneration((value) => value + 1);
  };

  return (
    <div className={styles.view}>
      <div ref={holder} className={styles.xterm} onClick={() => view.current?.term.focus()} />
      <TerminalKeys ctrl={ctrl} onPress={press} />
      {(ended !== null || error) && (
        <div className={cx(styles.ended, error && styles.endedError)} role={error ? 'alert' : 'status'}>
          <span className="caption ellipsis">{error ? `✕ ${error}` : `Exit code ${ended}`}</span>
          <Button variant="filled" onClick={restart}>
            New shell
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The row of keys a phone's keyboard lacks (#40), under the terminal. Keys
 * never take focus (pointerdown is cancelled), so the keyboard stays open.
 */
function TerminalKeys({ ctrl, onPress }: { ctrl: boolean; onPress: (id: string) => void }) {
  return (
    <div className={styles.keys} role="toolbar" aria-label="Terminal keys">
      {TERMINAL_KEYS.map((key) => (
        <button
          key={key.id}
          type="button"
          className={cx(
            'body',
            styles.key,
            key.label.length > 2 && styles.wideKey,
            key.id === 'ctrl' && ctrl && styles.held,
          )}
          aria-label={key.title}
          aria-pressed={key.id === 'ctrl' ? ctrl : undefined}
          title={key.title}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => onPress(key.id)}
        >
          {key.label}
        </button>
      ))}
    </div>
  );
}
