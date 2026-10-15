import type { KeyValueStore } from '../core/storage';

/** Where the user was, so reopening the app puts them back there (#19). */
export interface Session {
  /** Open project path, or null for the project space. */
  project: string | null;
  /** Explorer path stack per explorer root ('' = the space). */
  explorer: Record<string, string[]>;
  openFile: string | null;
  /** Cursor and scroll per file path, most recently used kept. */
  editors: Record<string, StoredEditorState>;
}

export interface EditorViewState {
  anchor: number;
  head: number;
  scrollTop: number;
}

interface StoredEditorState extends EditorViewState {
  savedMillis: number;
}

const STORAGE_KEY = 'pepino.session';
export const MAX_EDITOR_STATES = 50;

export const EMPTY_SESSION: Session = { project: null, explorer: {}, openFile: null, editors: {} };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Reads a stored session, dropping anything malformed instead of failing. */
export function parseSession(raw: string | null): Session {
  if (!raw) return EMPTY_SESSION;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return EMPTY_SESSION;
  }
  if (!isRecord(value)) return EMPTY_SESSION;

  const explorer: Session['explorer'] = {};
  if (isRecord(value.explorer)) {
    for (const [root, stack] of Object.entries(value.explorer)) {
      if (Array.isArray(stack) && stack.length > 0 && stack.every(isString)) explorer[root] = stack;
    }
  }
  const editors: Session['editors'] = {};
  if (isRecord(value.editors)) {
    for (const [path, state] of Object.entries(value.editors)) {
      if (isRecord(state) && [state.anchor, state.head, state.scrollTop, state.savedMillis].every(isNumber)) {
        editors[path] = state as unknown as StoredEditorState;
      }
    }
  }
  return {
    project: isString(value.project) ? value.project : null,
    explorer,
    openFile: isString(value.openFile) ? value.openFile : null,
    editors,
  };
}

/** Records [state] for [path], keeping the [MAX_EDITOR_STATES] most recently saved. */
export function withEditorState(session: Session, path: string, state: EditorViewState, now: number): Session {
  const entries = Object.entries({ ...session.editors, [path]: { ...state, savedMillis: now } })
    .sort(([, a], [, b]) => b.savedMillis - a.savedMillis)
    .slice(0, MAX_EDITOR_STATES);
  return { ...session, editors: Object.fromEntries(entries) };
}

export interface SessionStore {
  load(): Promise<Session>;
  update(change: (session: Session) => Session): Promise<void>;
}

export function createSessionStore(store: KeyValueStore): SessionStore {
  // Serialized like the recent projects: quick successive updates never overwrite each other.
  let queue: Promise<unknown> = Promise.resolve();
  return {
    async load() {
      return parseSession(await store.get(STORAGE_KEY));
    },
    update(change) {
      const next = queue.then(async () => {
        const session = change(parseSession(await store.get(STORAGE_KEY)));
        await store.set(STORAGE_KEY, JSON.stringify(session));
      });
      queue = next.catch(() => undefined);
      return next;
    },
  };
}
