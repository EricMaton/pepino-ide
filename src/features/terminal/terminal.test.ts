import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeTerminal, createUnavailableTerminal } from './terminal';

/*
 * The TypeScript side of the terminal (#37): what it sends the `Terminal`
 * plugin and how its events reach listeners. The PTY itself is tested on a
 * device (PtyDeviceTest).
 */
const handles = vi.hoisted(() => [] as { event: string; listener: (event: never) => void; remove: () => void }[]);
const plugin = vi.hoisted(() => ({
  spawn: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
  sessions: vi.fn(),
  history: vi.fn(),
  addListener: vi.fn(async (event: string, listener: (event: never) => void) => {
    const handle = { event, listener, remove: vi.fn() };
    handles.push(handle);
    return handle;
  }),
}));

vi.mock('@capacitor/core', () => ({ registerPlugin: () => plugin }));

beforeEach(() => {
  vi.clearAllMocks();
  handles.length = 0;
});

describe('native terminal (#37)', () => {
  it('starts a shell in a project folder and acts on it by id', async () => {
    const terminal = createNativeTerminal();
    plugin.spawn.mockResolvedValue({ id: 7, pid: 1234 });

    expect(await terminal.spawn({ cwd: 'work/app', cols: 80, rows: 24 })).toBe(7);
    expect(plugin.spawn).toHaveBeenCalledWith({ cwd: 'work/app', cols: 80, rows: 24 });
    await expect(terminal.spawn({ cwd: '', cols: 80, rows: 24 })).rejects.toThrow(/project/);

    await terminal.write(7, 'ls\r');
    await terminal.resize(7, 100, 40);
    await terminal.kill(7);
    expect(plugin.write).toHaveBeenCalledWith({ id: 7, data: 'ls\r' });
    expect(plugin.resize).toHaveBeenCalledWith({ id: 7, cols: 100, rows: 40 });
    expect(plugin.kill).toHaveBeenCalledWith({ id: 7 });

    plugin.sessions.mockResolvedValue({ sessions: [{ id: 7, pid: 1234, cwd: 'work/app' }] });
    expect(await terminal.sessions()).toEqual([{ id: 7, cwd: 'work/app' }]);
    plugin.history.mockResolvedValue({ data: '$ ls\r\n', end: 42 });
    expect(await terminal.history(7)).toEqual({ data: '$ ls\r\n', end: 42 });
    expect(plugin.history).toHaveBeenCalledWith({ id: 7 });
  });

  it('passes on what shells print and when they end, until told to stop', async () => {
    const terminal = createNativeTerminal();
    const data = vi.fn();
    const exit = vi.fn();
    const stopData = terminal.onData(data);
    terminal.onExit(exit);
    await Promise.resolve();

    const fire = (event: string, payload: unknown) =>
      handles.filter((handle) => handle.event === event).forEach((handle) => handle.listener(payload as never));
    fire('data', { id: 7, data: 'hello\r\n', end: 7 });
    fire('exit', { id: 7, code: 130 });
    expect(data).toHaveBeenCalledWith(7, 'hello\r\n', 7);
    expect(exit).toHaveBeenCalledWith(7, 130);

    stopData();
    await Promise.resolve();
    expect(handles.find((handle) => handle.event === 'data')?.remove).toHaveBeenCalled();
  });

  it('is not available on iOS or the web', async () => {
    const terminal = createUnavailableTerminal();
    expect(terminal.available).toBe(false);
    await expect(terminal.spawn({ cwd: 'work/app', cols: 80, rows: 24 })).rejects.toThrow(/Android/);
    expect(await terminal.sessions()).toEqual([]);
  });
});
