import { type PluginListenerHandle, registerPlugin } from '@capacitor/core';
import { canBeProject } from '../projects/projects';
import { ProjectSpaceError } from '../projects/errors';
import { resolveInRoot } from '../projects/paths';

/*
 * The terminal's backend (#37, ADR-004): shells to type into. On Android a
 * real shell on a PTY, in the native `Terminal` plugin (src/main/jni/pty.c);
 * iOS lets no app start processes (#43), and the web has none, so there the
 * backend says it is not available. A shell of the app's own (in JS, on the
 * project space) can come in behind the same interface later.
 */

/** A running shell: its id, and the project folder it started in (relative to the space root). */
export interface TerminalInfo {
  id: number;
  cwd: string;
}

/** What a shell printed last, and where it ends in all it printed (see [TerminalBackend.onData]). */
export interface TerminalHistory {
  data: string;
  end: number;
}

export interface TerminalBackend {
  /** Whether shells can be started here: false on iOS and the web. */
  readonly available: boolean;
  /** Starts a shell in project folder [cwd] (relative to the space root), [cols] x [rows]. Returns its id. */
  spawn(options: { cwd: string; cols: number; rows: number }): Promise<number>;
  /** Types [data] into shell [id]: text, control characters included ("\u0003" is Ctrl+C). */
  write(id: number, data: string): Promise<void>;
  /** Tells shell [id] its new size; what runs in it gets SIGWINCH. */
  resize(id: number, cols: number, rows: number): Promise<void>;
  /** Ends shell [id] and what it runs, as closing a terminal window does (SIGHUP). */
  kill(id: number): Promise<void>;
  /** The shells still running, which outlive the page (a reload, the app in the background). */
  sessions(): Promise<TerminalInfo[]>;
  /** What shell [id] printed last (the last 256 KB), to show again on attaching to it. */
  history(id: number): Promise<TerminalHistory>;
  /**
   * What shells print; [end] counts every character shell [id] printed so
   * far, these included, so one already in a [history] is told apart.
   * Returns the way to stop listening.
   */
  onData(listener: (id: number, data: string, end: number) => void): () => void;
  /** Shells that ended, with their exit code (128 + n for signal n). */
  onExit(listener: (id: number, code: number) => void): () => void;
}

interface TerminalPlugin {
  spawn(options: { cwd: string; cols: number; rows: number }): Promise<{ id: number; pid: number }>;
  write(options: { id: number; data: string }): Promise<void>;
  resize(options: { id: number; cols: number; rows: number }): Promise<void>;
  kill(options: { id: number }): Promise<void>;
  sessions(): Promise<{ sessions: { id: number; pid: number; cwd: string }[] }>;
  history(options: { id: number }): Promise<TerminalHistory>;
  addListener(
    event: 'data',
    listener: (event: { id: number; data: string; end: number }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(event: 'exit', listener: (event: { id: number; code: number }) => void): Promise<PluginListenerHandle>;
}

/** A plugin listener as a plain unsubscribe; one removed before it was added goes as soon as it is. */
function listen(adding: Promise<PluginListenerHandle>): () => void {
  let removed = false;
  void adding.then((handle) => {
    if (removed) void handle.remove();
  });
  return () => {
    if (removed) return;
    removed = true;
    void adding.then((handle) => handle.remove());
  };
}

/** Shells on PTYs through the native plugin (Android). */
export function createNativeTerminal(): TerminalBackend {
  const plugin = registerPlugin<TerminalPlugin>('Terminal');
  return {
    available: true,
    async spawn({ cwd, cols, rows }) {
      if (!canBeProject(cwd)) throw new ProjectSpaceError('InvalidName', 'Open a project to start a terminal in');
      return (await plugin.spawn({ cwd: resolveInRoot(cwd), cols, rows })).id;
    },
    write: (id, data) => plugin.write({ id, data }),
    resize: (id, cols, rows) => plugin.resize({ id, cols, rows }),
    kill: (id) => plugin.kill({ id }),
    async sessions() {
      return (await plugin.sessions()).sessions.map(({ id, cwd }) => ({ id, cwd }));
    },
    history: (id) => plugin.history({ id }),
    onData: (listener) => listen(plugin.addListener('data', ({ id, data, end }) => listener(id, data, end))),
    onExit: (listener) => listen(plugin.addListener('exit', ({ id, code }) => listener(id, code))),
  };
}

/** Where no app can start processes (iOS) or there is no shell (the web). */
export function createUnavailableTerminal(): TerminalBackend {
  const unavailable = () => Promise.reject(new Error('The terminal is only available on Android'));
  return {
    available: false,
    spawn: unavailable,
    write: unavailable,
    resize: unavailable,
    kill: unavailable,
    sessions: async () => [],
    history: unavailable,
    onData: () => () => undefined,
    onExit: () => () => undefined,
  };
}
