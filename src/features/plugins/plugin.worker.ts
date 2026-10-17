/// <reference lib="webworker" />
import { serveSandbox } from './connection';
import type { HostMessage, Port, WorkerMessage } from './protocol';

// One plugin per worker (#47): its sandbox runs here, off the UI thread.
serveSandbox(self as unknown as Port<WorkerMessage, HostMessage>);
