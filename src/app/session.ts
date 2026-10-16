import type { KeyValueStore } from '../core/storage';

/** Where the user was, so reopening the app puts them back there (#19). */
export interface Session {
  /** The active project's path, or null when there is none. */
  project: string | null;
  /** True when the workspace was showing, false for the explorer. */
  inWorkspace: boolean;
  /** Explorer path stack per explorer root ('' = the space). */
  explorer: Record<string, string[]>;
  /** File open on its own over the explorer, outside any workspace. */
  looseFile: string | null;
  /** The editor's tabs per workspace root, in tab order (#106). */
  openFiles: Record<string, string[]>;
  /** The active tab per workspace root. */
  activeFiles: Record<string, string>;
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

export const EMPTY_SESSION: Session = {
  project: null,
  inWorkspace: false,
  explorer: {},
  looseFile: null,
  openFiles: {},
  activeFiles: {},
  editors: {},
};

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
  const openFiles: Session['openFiles'] = {};
  if (isRecord(value.openFiles)) {
    for (const [root, files] of Object.entries(value.openFiles)) {
      if (Array.isArray(files) && files.every(isString)) openFiles[root] = files;
    }
  }
  const activeFiles: Session['activeFiles'] = {};
  if (isRecord(value.activeFiles)) {
    for (const [root, file] of Object.entries(value.activeFiles)) {
      if (isString(file)) activeFiles[root] = file;
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
    inWorkspace: value.inWorkspace === true,
    explorer,
    looseFile: isString(value.looseFile) ? value.looseFile : null,
    openFiles,
    activeFiles,
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
