import variant from '@jitl/quickjs-wasmfile-release-sync';
import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSRuntime,
  type QuickJSWASMModule,
} from 'quickjs-emscripten-core';
import type { SettingValue } from './manifest';

/*
 * A plugin's sandbox (#47, ADR-002): its main.js interpreted by QuickJS
 * (WebAssembly), with no DOM, no fetch and no global of the host's. All it
 * gets is `plugin.onActivate(api => …)`, and `api` reaches the host only
 * through [SandboxHost.call], where permissions are checked (#49). Every
 * stretch of the plugin's code runs against a deadline: a `while (true)` is
 * interrupted and the plugin lives on (#50). The worker (plugin.worker.ts)
 * runs one of these off the UI thread; the tests run it directly.
 */

export interface SandboxHost {
  /** An `api` call, by method name ("editor.getText"); resolves to plain data. */
  call(method: string, args: unknown[]): Promise<unknown>;
  log(level: 'log' | 'warn' | 'error', text: string): void;
  /** The worker stopped answering and was terminated (#50): the plugin is gone. */
  unresponsive?(): void;
}

export interface SandboxOptions {
  /** How long one stretch of the plugin's code may run before it is interrupted. */
  timeoutMs: number;
  /** QuickJS's heap for the plugin. */
  memoryBytes: number;
}

export const DEFAULT_SANDBOX_OPTIONS: SandboxOptions = { timeoutMs: 2000, memoryBytes: 32 * 1024 * 1024 };

/** The plugin's code failed: threw, or ran out of time ([timedOut]) or memory. */
export class PluginError extends Error {
  constructor(
    message: string,
    readonly timedOut = false,
  ) {
    super(message);
    this.name = 'PluginError';
  }
}

export interface Sandbox {
  /** Runs main.js, then the function it gave plugin.onActivate. */
  activate(): Promise<void>;
  /** Runs the plugin's command [id], as api.commands.register gave it. */
  runCommand(id: string): Promise<void>;
  /** Calls the plugin's listeners for [topic] (api.editor.onSave…). */
  emit(topic: string, payload: unknown): Promise<void>;
  /** Runs what plugin.onDeactivate gave, if anything. */
  deactivate(): Promise<void>;
  /** The commands the plugin has registered. */
  commands(): Promise<string[]>;
  dispose(): void;
}

/**
 * What the plugin sees, built inside QuickJS on top of one host function,
 * `__host(method, argsJson)`. Plain data crosses as JSON both ways.
 */
const PRELUDE = `
(() => {
  const commands = new Map();
  const listeners = new Map();
  let activate = null;
  let deactivate = null;
  // Kept here: the globals go away below, out of the plugin's reach
  const host = __host;
  const call = (method, ...args) =>
    host(method, JSON.stringify(args)).then((json) => (json === undefined ? undefined : JSON.parse(json)));
  const on = (topic, listener) => {
    if (typeof listener !== 'function') throw new TypeError(topic + ': give a function');
    if (!listeners.has(topic)) listeners.set(topic, []);
    listeners.get(topic).push(listener);
  };
  const settings = __settings;
  const capabilities = __capabilities;
  const api = Object.freeze({
    apiVersion: '1',
    commands: Object.freeze({
      register(id, run) {
        if (typeof run !== 'function') throw new TypeError('commands.register: give a function');
        commands.set(String(id), run);
      },
      execute: (id) => call('commands.execute', String(id)),
    }),
    editor: Object.freeze({
      getPath: () => call('editor.getPath'),
      getText: () => call('editor.getText'),
      setText: (text) => call('editor.setText', String(text)),
      getSelection: () => call('editor.getSelection'),
      insert: (text) => call('editor.insert', String(text)),
      insertSnippet: (body) => call('editor.insertSnippet', String(body)),
      onSave: (listener) => on('file.saved', listener),
      onChange: (listener) => on('editor.changed', listener),
      onOpen: (listener) => on('file.opened', listener),
    }),
    settings: Object.freeze({ get: (key) => settings[key] }),
    fs: Object.freeze({
      root: () => call('fs.root'),
      list: () => call('fs.list'),
      read: (path) => call('fs.read', String(path)),
      find: (query, limit) => call('fs.find', String(query), limit === undefined ? 20 : limit),
      search: (query, options) => call('fs.search', String(query), options === undefined ? {} : options),
    }),
    secrets: Object.freeze({
      has: (key) => call('secrets.has', String(key)),
      ask: (key) => call('secrets.ask', String(key)),
      forget: (key) => call('secrets.forget', String(key)),
    }),
    pages: Object.freeze({
      postMessage: (pageId, data) => call('pages.postMessage', String(pageId), data === undefined ? null : data),
      onMessage: (pageId, listener) => on('page.message:' + String(pageId), listener),
    }),
    window: Object.freeze({
      showMessage: (text) => call('window.showMessage', String(text)),
      showQuickPick: (items, options) =>
        call(
          'window.showQuickPick',
          Array.from(items, (item) =>
            typeof item === 'object' && item !== null
              ? { label: String(item.label), ...(item.detail !== undefined && { detail: String(item.detail) }) }
              : { label: String(item) },
          ),
          options === undefined ? {} : options,
        ),
      showInput: (options) => call('window.showInput', options === undefined ? {} : options),
    }),
    storage: Object.freeze({
      get: (key) => call('storage.get', String(key)),
      set: (key, value) => call('storage.set', String(key), value === undefined ? null : value),
      delete: (key) => call('storage.delete', String(key)),
    }),
    // Only a plugin allowed the network gets a way to it (#49); the host checks again on each call
    ...(capabilities.includes('network') && {
      network: Object.freeze({
        fetch: (url, init) => call('network.fetch', String(url), init === undefined ? {} : init),
      }),
    }),
  });
  globalThis.plugin = Object.freeze({
    onActivate(run) { activate = run; },
    onDeactivate(run) { deactivate = run; },
  });
  globalThis.__pepino = {
    activate: () => (activate ? activate(api) : undefined),
    deactivate: () => (deactivate ? deactivate() : undefined),
    command(id) {
      const run = commands.get(id);
      if (!run) throw new Error('The plugin has no command "' + id + '"');
      return run();
    },
    emit: (topic, payload) =>
      Promise.all((listeners.get(topic) || []).map((listener) => listener(payload))).then(() => undefined),
    commands: () => [...commands.keys()],
  };
  delete globalThis.__host;
  delete globalThis.__settings;
  delete globalThis.__capabilities;
})();
`;

let module: Promise<QuickJSWASMModule> | null = null;
/** QuickJS's WebAssembly, loaded once per worker (or test run). */
const quickjs = () => (module ??= newQuickJSWASMModuleFromVariant(variant));

export async function createSandbox(
  main: string,
  settings: Record<string, SettingValue>,
  host: SandboxHost,
  options: SandboxOptions = DEFAULT_SANDBOX_OPTIONS,
  /** The permissions the plugin may use, for what the api offers it (network). */
  capabilities: readonly string[] = [],
): Promise<Sandbox> {
  const runtime: QuickJSRuntime = (await quickjs()).newRuntime();
  runtime.setMemoryLimit(options.memoryBytes);
  runtime.setMaxStackSize(1024 * 1024);
  // Each stretch of the plugin's code gets [timeoutMs]; outside one, nothing runs
  let deadline = Infinity;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const vm: QuickJSContext = runtime.newContext();
  let disposed = false;

  /** Runs [work] (the plugin's code) against the deadline. */
  const slice = <T>(work: () => T): T => {
    deadline = Date.now() + options.timeoutMs;
    try {
      return work();
    } finally {
      deadline = Infinity;
    }
  };
  /** Runs what is waiting (promise reactions), after a host reply: also against the deadline. */
  const pump = () => {
    if (disposed) return;
    slice(() => {
      const ran = runtime.executePendingJobs();
      if (ran.error) {
        host.log('error', describe(vm.dump(ran.error)));
        ran.error.dispose();
      }
    });
  };

  // console, to the host's log
  const consoleHandle = vm.newObject();
  for (const level of ['log', 'warn', 'error'] as const) {
    const fn = vm.newFunction(level, (...args) => {
      host.log(level, args.map((arg) => describe(vm.dump(arg))).join(' '));
    });
    vm.setProp(consoleHandle, level, fn);
    fn.dispose();
  }
  vm.setProp(vm.global, 'console', consoleHandle);
  consoleHandle.dispose();

  // The one way out: __host(method, argsJson) → a promise of the reply's JSON
  const hostFn = vm.newFunction('__host', (methodHandle, argsHandle) => {
    const method = vm.getString(methodHandle);
    const args = JSON.parse(vm.getString(argsHandle)) as unknown[];
    const deferred = vm.newPromise();
    host.call(method, args).then(
      (result) => {
        if (disposed) return;
        if (result === undefined) deferred.resolve();
        else {
          const json = vm.newString(JSON.stringify(result));
          deferred.resolve(json);
          json.dispose();
        }
      },
      (failure: unknown) => {
        if (disposed) return;
        const error = vm.newError(failure instanceof Error ? failure.message : String(failure));
        deferred.reject(error);
        error.dispose();
      },
    );
    void deferred.settled.then(() => {
      if (disposed) return;
      pump();
      deferred.dispose();
    });
    return deferred.handle;
  });
  vm.setProp(vm.global, '__host', hostFn);
  hostFn.dispose();
  const settingsHandle = vm.unwrapResult(vm.evalCode(`(${JSON.stringify(settings)})`));
  vm.setProp(vm.global, '__settings', settingsHandle);
  settingsHandle.dispose();
  const capabilitiesHandle = vm.unwrapResult(vm.evalCode(JSON.stringify(capabilities)));
  vm.setProp(vm.global, '__capabilities', capabilitiesHandle);
  capabilitiesHandle.dispose();
  vm.unwrapResult(vm.evalCode(PRELUDE, 'pepino:prelude')).dispose();

  /** Runs [code] in the plugin, awaiting it when it returns a promise; its errors as [PluginError]s. */
  const run = async (code: string, filename = 'pepino:call'): Promise<QuickJSHandle | null> => {
    if (disposed) throw new PluginError('The plugin has been stopped');
    const result = slice(() => vm.evalCode(code, filename));
    if (result.error) throw failure(result.error);
    // A promise or not, awaited the same way: it settles as the host replies (pump)
    const settled = vm.resolvePromise(result.value);
    result.value.dispose();
    pump();
    const outcome = await settled;
    if (outcome.error) throw failure(outcome.error);
    return outcome.value;
  };

  /** A QuickJS exception as a [PluginError]: "interrupted" means it ran out of time. */
  const failure = (error: QuickJSHandle) => {
    const dumped = vm.dump(error);
    error.dispose();
    const message = describe(dumped);
    const timedOut = /interrupted/i.test(message);
    return new PluginError(
      timedOut ? `The plugin ran for more than ${options.timeoutMs} ms and was stopped` : message,
      timedOut,
    );
  };
  const done = async (code: string, filename?: string) => (await run(code, filename))?.dispose();

  return {
    async activate() {
      await done(main, 'main.js');
      await done('__pepino.activate()');
    },
    runCommand: (id) => done(`__pepino.command(${JSON.stringify(id)})`),
    emit: (topic, payload) => done(`__pepino.emit(${JSON.stringify(topic)}, ${JSON.stringify(payload ?? null)})`),
    deactivate: () => done('__pepino.deactivate()'),
    async commands() {
      const handle = await run('__pepino.commands()');
      if (!handle) return [];
      const ids = vm.dump(handle) as string[];
      handle.dispose();
      return ids;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      vm.dispose();
      runtime.dispose();
    },
  };
}

/** An exception or any value as one line of text. */
function describe(value: unknown): string {
  if (value && typeof value === 'object' && 'message' in value) {
    const { name, message } = value as { name?: string; message?: string };
    return name && name !== 'Error' ? `${name}: ${message}` : String(message);
  }
  return typeof value === 'string' ? value : JSON.stringify(value);
}
