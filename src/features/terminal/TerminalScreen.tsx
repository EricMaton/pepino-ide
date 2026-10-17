import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef, useState } from 'react';
import { TopBar } from '../../app/TopBar';
import { useServices } from '../../app/services';
import { Button } from '../../ui/components';
import { cx } from '../../ui/cx';
import { errorMessage } from '../projects/errors';
import { resolveInRoot } from '../projects/paths';
import type { ProjectInfo } from '../projects/projects';
import styles from './TerminalScreen.module.css';
import type { TerminalBackend } from './terminal';

/*
 * TERMINAL (#39, ADR-004): xterm.js on a shell in the active project. The
 * screen stays mounted while other tabs show, so the scrollback stays; the
 * shell belongs to the native plugin, so it outlives even the page, and a
 * page that loads again attaches to it, showing what it printed last.
 */

/** xterm's colours: the app's tokens for the ground, a palette that reads on it for ANSI. */
function theme() {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    background: token('--bg', '#0b0b0b'),
    foreground: token('--fg', '#f4f4f0'),
    cursor: token('--primary', '#e10600'),
    cursorAccent: token('--bg', '#0b0b0b'),
    selectionBackground: '#e1060055',
    black: '#1a1a1a',
    red: token('--pepino-red', '#e10600'),
    green: token('--pepino-green', '#3fd46b'),
    yellow: token('--pepino-amber', '#f2b33d'),
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
  };
}

const FONT_SIZE = 13;

export default function TerminalScreen({ project, visible }: { project: ProjectInfo | null; visible: boolean }) {
  const { terminal } = useServices();
  const subtitle = !terminal.available ? 'ANDROID ONLY' : project ? `${project.name} · sh` : 'NO PROJECT';
  return (
    <div className={styles.screen} hidden={!visible}>
      {visible && <TopBar title="Terminal" subtitle={subtitle} label="Search commands · Terminal" />}
      {!terminal.available ? (
        <Note title="The terminal runs on Android">
          iOS lets no app start programs, and the browser has no shell. Everything else in Pepino works the same.
        </Note>
      ) : project ? (
        <TerminalView key={project.path} backend={terminal} path={project.path} visible={visible} />
      ) : (
        <Note title="Open a project first">The terminal starts in the open project&apos;s folder.</Note>
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
    const typing = term.onData((data) => {
      if (current.id !== null) void backend.write(current.id, data);
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
      term.dispose();
      view.current = null;
    };
  }, [backend, path, generation]);

  // The size follows the holder: the screen turning, the keyboard opening or closing
  useEffect(() => {
    const element = holder.current;
    if (!element || !visible) return;
    const refit = () => {
      const current = view.current;
      if (!current || element.clientWidth === 0 || element.clientHeight === 0) return;
      const { cols, rows } = current.term;
      current.fit.fit();
      if (current.id !== null && (current.term.cols !== cols || current.term.rows !== rows)) {
        void backend.resize(current.id, current.term.cols, current.term.rows);
      }
    };
    const observer = new ResizeObserver(refit);
    observer.observe(element);
    refit();
    view.current?.term.focus();
    return () => observer.disconnect();
  }, [backend, visible, generation]);

  const restart = () => {
    setEnded(null);
    setError(null);
    setGeneration((value) => value + 1);
  };

  return (
    <div className={styles.view}>
      <div ref={holder} className={styles.xterm} onClick={() => view.current?.term.focus()} />
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
