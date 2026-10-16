import type { EventChannel } from '../../core/events';
import { ProjectSpaceError } from '../projects/errors';
import type { FileEntry } from '../projects/files';
import type { FsEvents } from '../projects/observed';
import { basename, isWithin, parentPath, resolveInRoot } from '../projects/paths';
import type { ProjectSpace } from '../projects/projectSpace';
import { fuzzyFind } from './fuzzy';

/*
 * The workspace (#106): the open project as a unit of work — its file tree,
 * the open files (the editor's tabs) and the active one. The UI, plugins (#48) and
 * the AI agent (#58) all work on a project through this one API, and it
 * keeps itself in sync from the `fs.*` events, whoever changed the files.
 */
export interface WorkspaceState {
  /** Root of the workspace: the open project, or '' for the whole project space. */
  root: string;
  activeFile: string | null;
  /** The editor's tabs, in tab order. */
  openFiles: readonly string[];
}

export type WorkspaceEvents = {
  'workspace.changed': WorkspaceState;
  /** Someone (a plugin, the agent, the tree) asked to open a file in the editor. */
  'workspace.openRequested': { path: string };
};

export interface TextMatch {
  path: string;
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
  /** The matching line, trimmed to [MAX_LINE_PREVIEW] characters. */
  text: string;
}

export interface SavedOpenFiles {
  files: string[];
  active: string | null;
}

/** Persists the open files and the active one per root (the session store in the app). */
export interface OpenFilesStore {
  load(root: string): Promise<SavedOpenFiles>;
  save(root: string, files: readonly string[], active: string | null): Promise<void>;
}

export const IGNORED_DIRS: ReadonlySet<string> = new Set(['.pepino', '.git', 'node_modules']);
export const MAX_FILES = 20_000;
export const MAX_SEARCH_FILE_BYTES = 1_000_000;
const MAX_LINE_PREVIEW = 200;

export interface Workspace {
  getState(): WorkspaceState;
  /** Calls [listener] after every state change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  setRoot(root: string): Promise<void>;
  /** Shows [path] in the editor, opening a tab for it (next to the active one) if it has none. */
  setActiveFile(path: string | null): void;
  /** Closes [path]'s tab; closing the active one activates its neighbour (or nothing). */
  closeFile(path: string): void;
  /** Every file under the root (ignoring `.pepino`, `.git`, `node_modules`), cached until files change. */
  listFiles(): Promise<FileEntry[]>;
  /** Files whose path fuzzy-matches [query], best first. */
  findFiles(query: string, limit?: number): Promise<string[]>;
  /** Lines containing [query] in the workspace's text files. */
  searchText(query: string, options?: { limit?: number; caseSensitive?: boolean }): Promise<TextMatch[]>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, text: string): Promise<void>;
  /** Asks the app to show [path] in the editor. */
  openFile(path: string): Promise<void>;
}

export function createWorkspace(
  space: ProjectSpace,
  events: EventChannel<FsEvents & WorkspaceEvents>,
  store: OpenFilesStore,
): Workspace {
  let state: WorkspaceState = { root: '', activeFile: null, openFiles: [] };
  let files: Promise<FileEntry[]> | null = null;
  let rootToken = 0;
  const listeners = new Set<() => void>();

  const setState = (next: WorkspaceState, persist = false) => {
    state = next;
    if (persist) {
      store
        .save(next.root, next.openFiles, next.activeFile)
        .catch((error) => console.error('Cannot save open files', error));
    }
    listeners.forEach((listener) => listener());
    events.publish('workspace.changed', next);
  };

  /** [path] resolved and checked to be inside the workspace root. */
  const inside = (path: string): string => {
    const resolved = resolveInRoot(path);
    if (!isWithin(resolved, state.root)) {
      throw new ProjectSpaceError('EscapesRoot', `Outside the workspace: ${path}`);
    }
    return resolved;
  };

  const invalidate = (path: string) => {
    if (isWithin(path, state.root) || isWithin(state.root, path)) files = null;
  };

  events.subscribe('fs.created', ({ path }) => invalidate(path));
  events.subscribe('fs.written', ({ path }) => invalidate(path));
  /** [state] without the tabs [closing] matches; a closed active tab hands over to its neighbour. */
  const withoutTabs = (closing: (file: string) => boolean): WorkspaceState => {
    const openFiles = state.openFiles.filter((file) => !closing(file));
    let activeFile = state.activeFile;
    if (activeFile !== null && closing(activeFile)) {
      // The first tab still open to the right of the active one, else the last one to its left.
      const index = state.openFiles.indexOf(activeFile);
      const after = state.openFiles.slice(index + 1).find((file) => !closing(file));
      activeFile = after ?? openFiles.filter((file) => state.openFiles.indexOf(file) < index).pop() ?? null;
    }
    return { ...state, openFiles, activeFile };
  };

  events.subscribe('fs.deleted', ({ path }) => {
    invalidate(path);
    const next = withoutTabs((file) => isWithin(file, path));
    if (next.openFiles.length !== state.openFiles.length || next.activeFile !== state.activeFile) setState(next, true);
  });
  events.subscribe('fs.moved', ({ from, to }) => {
    invalidate(from);
    invalidate(to);
    const follow = (file: string) => (isWithin(file, from) ? to + file.slice(from.length) : file);
    // The project itself can be renamed or moved: the workspace (and its tabs) go with it.
    const root = state.root === '' ? '' : follow(state.root);
    const openFiles = state.openFiles.map(follow);
    const activeFile = state.activeFile && follow(state.activeFile);
    if (
      root !== state.root ||
      openFiles.some((file, i) => file !== state.openFiles[i]) ||
      activeFile !== state.activeFile
    ) {
      setState({ root, openFiles, activeFile }, true);
    }
  });

  /** The [paths] that are still files, in the same order. */
  async function stillFiles(paths: readonly string[]): Promise<string[]> {
    const folders = new Map<string, Promise<Set<string>>>();
    const filesIn = (folder: string) => {
      let found = folders.get(folder);
      if (!found) {
        found = space.listDirectory(folder).then(
          (entries) => new Set(entries.filter((entry) => !entry.isDirectory).map((entry) => entry.path)),
          () => new Set<string>(),
        );
        folders.set(folder, found);
      }
      return found;
    };
    const kept = await Promise.all(paths.map(async (path) => (await filesIn(parentPath(path))).has(path)));
    return paths.filter((_, i) => kept[i]);
  }

  async function walk(root: string): Promise<FileEntry[]> {
    const found: FileEntry[] = [];
    const queue = [root];
    while (queue.length > 0 && found.length < MAX_FILES) {
      const dir = queue.shift()!;
      let entries: FileEntry[];
      try {
        entries = await space.listDirectory(dir);
      } catch {
        continue; // a folder deleted mid-walk just isn't listed
      }
      for (const entry of entries) {
        if (entry.isDirectory) {
          if (!IGNORED_DIRS.has(entry.name)) queue.push(entry.path);
        } else if (found.length < MAX_FILES) {
          found.push(entry);
        }
      }
    }
    return found;
  }

  const workspace: Workspace = {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async setRoot(rawRoot) {
      const root = resolveInRoot(rawRoot);
      if (root === state.root && rootToken > 0) return;
      const token = ++rootToken;
      files = null;
      setState({ root, activeFile: null, openFiles: [] });
      const saved = await store.load(root).catch((): SavedOpenFiles => ({ files: [], active: null }));
      // Files deleted or moved while the project was closed are forgotten.
      const kept = await stillFiles(saved.files.filter((file) => isWithin(file, root)));
      if (token !== rootToken) return; // another root was set meanwhile
      // Files opened while loading (e.g. from the search) stay in front of the saved ones.
      const openFiles = [...new Set([...state.openFiles, ...kept])];
      const activeFile = state.activeFile ?? (saved.active && kept.includes(saved.active) ? saved.active : null);
      setState({ ...state, openFiles, activeFile });
    },

    setActiveFile(path) {
      if (path === null) {
        if (state.activeFile !== null) setState({ ...state, activeFile: null }, true);
        return;
      }
      const file = inside(path);
      if (file === state.activeFile) return;
      let openFiles = state.openFiles;
      if (!openFiles.includes(file)) {
        // Like VS Code: a new tab opens right after the active one.
        const at = state.activeFile ? openFiles.indexOf(state.activeFile) + 1 : openFiles.length;
        openFiles = [...openFiles.slice(0, at), file, ...openFiles.slice(at)];
      }
      setState({ ...state, activeFile: file, openFiles }, true);
    },

    closeFile(path) {
      const file = resolveInRoot(path);
      if (state.openFiles.includes(file))
        setState(
          withoutTabs((open) => open === file),
          true,
        );
    },

    listFiles() {
      if (!files) {
        const root = state.root;
        files = walk(root);
        files.catch(() => {
          files = null;
        });
      }
      return files;
    },

    async findFiles(query, limit = 50) {
      if (!query.trim()) return [];
      const root = state.root;
      const prefix = root === '' ? 0 : root.length + 1;
      const paths = (await workspace.listFiles()).map((file) => file.path);
      // Match on the path inside the workspace, so the project's own name never skews the ranking.
      return fuzzyFind(
        query,
        paths.map((path) => path.slice(prefix)),
        limit,
      ).map((relative) => (root === '' ? relative : `${root}/${relative}`));
    },

    async searchText(query, { limit = 200, caseSensitive = false } = {}) {
      if (!query) return [];
      const needle = caseSensitive ? query : query.toLowerCase();
      const matches: TextMatch[] = [];
      for (const file of await workspace.listFiles()) {
        if (file.sizeBytes > MAX_SEARCH_FILE_BYTES) continue;
        let text: string;
        try {
          text = await space.readTextFile(file.path);
        } catch {
          continue;
        }
        if (text.includes('\u0000')) continue; // binary
        const lines = text.split(/\r\n?|\n/);
        for (let i = 0; i < lines.length; i++) {
          const column = (caseSensitive ? lines[i] : lines[i].toLowerCase()).indexOf(needle);
          if (column === -1) continue;
          matches.push({ path: file.path, line: i + 1, column: column + 1, text: lines[i].slice(0, MAX_LINE_PREVIEW) });
          if (matches.length >= limit) return matches;
        }
      }
      return matches;
    },

    // async so a path outside the root rejects (like every other failure) instead of throwing.
    async readFile(path) {
      return space.readTextFile(inside(path));
    },

    async writeFile(path, text) {
      await space.writeTextFile(inside(path), text);
    },

    async openFile(path) {
      const file = inside(path);
      const siblings = await space.listDirectory(parentPath(file));
      if (!siblings.some((entry) => entry.path === file && !entry.isDirectory)) {
        throw new ProjectSpaceError('NotFound', `Not a file: ${basename(file) || path}`);
      }
      events.publish('workspace.openRequested', { path: file });
    },
  };
  return workspace;
}
