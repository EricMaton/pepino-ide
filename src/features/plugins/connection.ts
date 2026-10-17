import type { SettingValue } from './manifest';
import type { HostMessage, Port, WorkerMessage } from './protocol';
import { createSandbox, PluginError, type Sandbox, type SandboxHost, type SandboxOptions } from './sandbox';

/*
 * The two ends of a plugin's worker (#47). The worker serves one sandbox
 * ([serveSandbox], plugin.worker.ts); the app talks to it through a
 * [PluginConnection] ([connect]), which answers the plugin's api calls with
 * its [SandboxHost] and turns failures back into [PluginError]s.
 */

export interface PluginConnection {
  init(
    main: string,
    settings: Record<string, SettingValue>,
    options: SandboxOptions,
    capabilities?: string[],
  ): Promise<void>;
  activate(): Promise<void>;
  deactivate(): Promise<void>;
  runCommand(id: string): Promise<void>;
  emit(topic: string, payload: unknown): Promise<void>;
  commands(): Promise<string[]>;
  /** Stops the worker outright: what it was doing never finishes. */
  terminate(): void;
}

/** The worker's side: one sandbox, driven by the app's messages over [port]. */
export function serveSandbox(port: Port<WorkerMessage, HostMessage>) {
  let sandbox: Sandbox | null = null;
  let nextCall = 1;
  const calls = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const host: SandboxHost = {
    call(method, args) {
      const call = nextCall++;
      port.postMessage({ type: 'call', call, method, args });
      return new Promise((resolve, reject) => calls.set(call, { resolve, reject }));
    },
    log: (level, text) => port.postMessage({ type: 'log', level, text }),
  };

  port.addEventListener('message', ({ data: message }) => {
    if (message.type === 'reply') {
      const waiting = calls.get(message.call);
      calls.delete(message.call);
      if (message.error !== undefined) waiting?.reject(new Error(message.error));
      else waiting?.resolve(message.result);
      return;
    }
    const answer = async (): Promise<unknown> => {
      if (message.type === 'init') {
        sandbox?.dispose();
        sandbox = await createSandbox(message.main, message.settings, host, message.options, message.capabilities);
        return undefined;
      }
      if (!sandbox) throw new PluginError('The plugin has not started');
      switch (message.type) {
        case 'activate':
          return sandbox.activate();
        case 'deactivate':
          return sandbox.deactivate();
        case 'command':
          return sandbox.runCommand(message.id);
        case 'event':
          return sandbox.emit(message.topic, message.payload);
        case 'commands':
          return sandbox.commands();
      }
    };
    answer().then(
      (result) => port.postMessage({ type: 'done', seq: message.seq, result }),
      (failure: unknown) =>
        port.postMessage({
          type: 'done',
          seq: message.seq,
          error: {
            message: failure instanceof Error ? failure.message : String(failure),
            timedOut: failure instanceof PluginError && failure.timedOut,
          },
        }),
    );
  });
}

/**
 * How long a worker with requests pending may go without a word before it is
 * taken for stuck (#50): far longer than the sandbox's own deadline, which
 * should have stopped any runaway code by then. Waiting on the host (an api
 * call in progress) is not being stuck.
 */
export const WATCHDOG_MS = 10_000;

/**
 * The app's side of [port]: requests out, the plugin's calls answered by
 * [host]. A worker that stops answering is terminated ([terminate]) and
 * [SandboxHost.unresponsive] told: the last resort, past the sandbox's own
 * interrupt (#50).
 */
export function connect(
  port: Port<HostMessage, WorkerMessage>,
  host: SandboxHost,
  { terminate = () => undefined, watchdogMs = WATCHDOG_MS }: { terminate?: () => void; watchdogMs?: number } = {},
): PluginConnection {
  let nextSeq = 1;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let stopped = false;
  // The watchdog: when the worker was last heard from, and the api calls the host is still answering
  let lastHeard = Date.now();
  let hostCalls = 0;
  let watchdog: ReturnType<typeof setInterval> | undefined;
  const watch = () => {
    if (watchdog !== undefined) return;
    watchdog = setInterval(
      () => {
        if (pending.size === 0) {
          clearInterval(watchdog);
          watchdog = undefined;
          return;
        }
        if (hostCalls > 0 || Date.now() - lastHeard <= watchdogMs) return;
        stop(new PluginError(`The plugin stopped responding for ${watchdogMs / 1000} s and was stopped`, true));
        host.unresponsive?.();
      },
      Math.max(10, Math.min(1000, watchdogMs / 4)),
    );
  };
  const stop = (reason: PluginError) => {
    if (stopped) return;
    stopped = true;
    clearInterval(watchdog);
    terminate();
    for (const waiting of pending.values()) waiting.reject(reason);
    pending.clear();
  };

  port.addEventListener('message', ({ data: message }) => {
    lastHeard = Date.now();
    switch (message.type) {
      case 'done': {
        const waiting = pending.get(message.seq);
        pending.delete(message.seq);
        if (message.error) waiting?.reject(new PluginError(message.error.message, message.error.timedOut));
        else waiting?.resolve(message.result);
        break;
      }
      case 'call':
        hostCalls++;
        host
          .call(message.method, message.args)
          .finally(() => {
            hostCalls--;
            lastHeard = Date.now();
          })
          .then(
            (result) => !stopped && port.postMessage({ type: 'reply', call: message.call, result }),
            (failure: unknown) =>
              !stopped &&
              port.postMessage({
                type: 'reply',
                call: message.call,
                error: failure instanceof Error ? failure.message : String(failure),
              }),
          );
        break;
      case 'log':
        host.log(message.level, message.text);
        break;
    }
  });

  // The seq is filled in here; each request is answered by its `done`
  type Request = HostMessage extends infer M ? (M extends { seq: number } ? Omit<M, 'seq'> : never) : never;
  const request = <T>(message: Request): Promise<T> => {
    if (stopped) return Promise.reject(new PluginError('The plugin has been stopped'));
    const seq = nextSeq++;
    return new Promise<T>((resolve, reject) => {
      pending.set(seq, { resolve: resolve as (value: unknown) => void, reject });
      if (pending.size === 1) lastHeard = Date.now();
      port.postMessage({ ...message, seq } as HostMessage);
      watch();
    });
  };

  return {
    init: (main, settings, options, capabilities = []) =>
      request({ type: 'init', main, settings, options, capabilities }),
    activate: () => request({ type: 'activate' }),
    deactivate: () => request({ type: 'deactivate' }),
    runCommand: (id) => request({ type: 'command', id }),
    emit: (topic, payload) => request({ type: 'event', topic, payload }),
    commands: () => request<string[]>({ type: 'commands' }),
    terminate: () => stop(new PluginError('The plugin has been stopped')),
  };
}

/** A plugin in a Web Worker of its own, off the UI thread (the app; the tests use [connect] on a MessageChannel). */
export function createWorkerConnection(host: SandboxHost): PluginConnection {
  const worker = new Worker(new URL('./plugin.worker.ts', import.meta.url), { type: 'module', name: 'pepino-plugin' });
  return connect(worker as unknown as Port<HostMessage, WorkerMessage>, host, { terminate: () => worker.terminate() });
}
