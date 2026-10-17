import type { SettingValue } from './manifest';
import type { SandboxOptions } from './sandbox';

/*
 * What the app and a plugin's worker say to each other (#47): the app's
 * requests (each answered by a `done` with its seq), the plugin's api calls
 * (each answered by a `reply`), and its console. Only plain data crosses.
 */

export type HostMessage =
  | { type: 'init'; seq: number; main: string; settings: Record<string, SettingValue>; options: SandboxOptions }
  | { type: 'activate' | 'deactivate' | 'commands'; seq: number }
  | { type: 'command'; seq: number; id: string }
  | { type: 'event'; seq: number; topic: string; payload: unknown }
  | { type: 'reply'; call: number; result?: unknown; error?: string };

export type WorkerMessage =
  | { type: 'done'; seq: number; result?: unknown; error?: { message: string; timedOut: boolean } }
  | { type: 'call'; call: number; method: string; args: unknown[] }
  | { type: 'log'; level: 'log' | 'warn' | 'error'; text: string };

/** Either end of the conversation: a Worker, the worker's own scope, or a MessagePort in the tests. */
export interface Port<Out, In> {
  postMessage(message: Out): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<In>) => void): void;
}
