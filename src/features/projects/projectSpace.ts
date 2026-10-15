import { ProjectSpaceError } from './errors';
import { type FileEntry, isValidEntryName } from './files';
import { basename, isWithin, joinPath, parentPath, resolveInRoot } from './paths';

export interface FsStat {
  isDirectory: boolean;
  sizeBytes: number;
  modifiedMillis: number;
}

/**
 * Raw storage under the project space root. Paths are already normalized and
 * root-relative; the backend does no validation of its own.
 */
export interface FsBackend {
  /** null when nothing exists at [path]. */
  stat(path: string): Promise<FsStat | null>;
  list(path: string): Promise<Array<FsStat & { name: string }>>;
  mkdir(path: string): Promise<void>;
  readText(path: string): Promise<string>;
  /** Creates or replaces the file at [path] with UTF-8 [text]. */
  writeText(path: string, text: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** Recursive for directories. */
  copy(from: string, to: string): Promise<void>;
  /** Recursive for directories. */
  remove(path: string): Promise<void>;
}

/**
 * The reserved folder holding every project. All paths are relative to its
 * root ('' is the root) and can never escape it. Failures reject with
 * [ProjectSpaceError].
 */
export interface ProjectSpace {
  ensureCreated(): Promise<void>;
  /** Direct children of [path], unsorted. */
  listDirectory(path: string): Promise<FileEntry[]>;
  /** Creates an empty file at [path]. Fails if it already exists. */
  createFile(path: string): Promise<void>;
  /** Creates a directory at [path]. Fails if it already exists. */
  createDirectory(path: string): Promise<void>;
  /** UTF-8 contents of the file at [path]. */
  readTextFile(path: string): Promise<string>;
  /** Creates or replaces the file at [path]; its folder must exist. */
  writeTextFile(path: string, text: string): Promise<void>;
  /** Renames [path] to [newName], keeping it in the same directory. */
  rename(path: string, newName: string): Promise<void>;
  /** Moves [source] into [destinationDir], keeping its name. */
  move(source: string, destinationDir: string): Promise<void>;
  /** Copies [source] into [destinationDir] (recursively for directories). */
  copy(source: string, destinationDir: string): Promise<void>;
  /** Deletes [path] (recursively for directories). */
  delete(path: string): Promise<void>;
}

export function createProjectSpace(backend: FsBackend): ProjectSpace {
  async function io<T>(action: string, path: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof ProjectSpaceError) throw error;
      throw new ProjectSpaceError('Io', `Cannot ${action}: ${path || '/'}`, { cause: error });
    }
  }

  async function existing(path: string): Promise<FsStat> {
    const stat = await io('read', path, () => backend.stat(path));
    if (!stat) throw new ProjectSpaceError('NotFound', `Not found: ${path || '/'}`);
    return stat;
  }

  async function directory(path: string): Promise<void> {
    const stat = await existing(path);
    if (!stat.isDirectory) {
      throw new ProjectSpaceError('NotADirectory', `Not a directory: ${path || '/'}`);
    }
  }

  async function ensureAbsent(path: string): Promise<void> {
    if (await io('read', path, () => backend.stat(path))) {
      throw new ProjectSpaceError('AlreadyExists', `Already exists: ${basename(path)}`);
    }
  }

  function notRoot(path: string, action: string): void {
    if (path === '') {
      throw new ProjectSpaceError('InvalidName', `Cannot ${action} the project space root`);
    }
  }

  async function writablePath(rawPath: string): Promise<string> {
    const path = resolveInRoot(rawPath);
    notRoot(path, 'create');
    if (!isValidEntryName(basename(path))) {
      throw new ProjectSpaceError('InvalidName', `Invalid name: ${basename(path)}`);
    }
    await directory(parentPath(path));
    return path;
  }

  async function newEntry(rawPath: string): Promise<string> {
    const path = await writablePath(rawPath);
    await ensureAbsent(path);
    return path;
  }

  async function transferTarget(rawSource: string, rawDestination: string, verb: string) {
    const source = resolveInRoot(rawSource);
    const destination = resolveInRoot(rawDestination);
    notRoot(source, verb);
    await existing(source);
    await directory(destination);
    if (parentPath(source) === destination) {
      throw new ProjectSpaceError('AlreadyExists', `Already in that folder: ${basename(source)}`);
    }
    if (isWithin(destination, source)) {
      throw new ProjectSpaceError('IntoItself', `Cannot ${verb} a folder into itself`);
    }
    const target = joinPath(destination, basename(source));
    await ensureAbsent(target);
    return { source, target };
  }

  return {
    async ensureCreated() {
      const stat = await io('read', '', () => backend.stat(''));
      if (!stat) await io('create', '', () => backend.mkdir(''));
      else if (!stat.isDirectory) throw new ProjectSpaceError('NotADirectory', 'Project space is not a directory');
    },

    async listDirectory(rawPath) {
      const path = resolveInRoot(rawPath);
      await directory(path);
      const children = await io('list', path, () => backend.list(path));
      return children.map(({ name, isDirectory, sizeBytes, modifiedMillis }) => ({
        name,
        path: joinPath(path, name),
        isDirectory,
        sizeBytes: isDirectory ? 0 : sizeBytes,
        modifiedMillis,
      }));
    },

    async createFile(rawPath) {
      const path = await newEntry(rawPath);
      await io('create file', path, () => backend.writeText(path, ''));
    },

    async createDirectory(rawPath) {
      const path = await newEntry(rawPath);
      await io('create folder', path, () => backend.mkdir(path));
    },

    async readTextFile(rawPath) {
      const path = resolveInRoot(rawPath);
      if ((await existing(path)).isDirectory) {
        throw new ProjectSpaceError('IsADirectory', `Is a folder: ${basename(path) || '/'}`);
      }
      return io('read', path, () => backend.readText(path));
    },

    async writeTextFile(rawPath, text) {
      const path = await writablePath(rawPath);
      if ((await io('read', path, () => backend.stat(path)))?.isDirectory) {
        throw new ProjectSpaceError('IsADirectory', `Is a folder: ${basename(path)}`);
      }
      await io('write', path, () => backend.writeText(path, text));
    },

    async rename(rawPath, newName) {
      const path = resolveInRoot(rawPath);
      notRoot(path, 'rename');
      await existing(path);
      if (!isValidEntryName(newName)) {
        throw new ProjectSpaceError('InvalidName', `Invalid name: ${newName}`);
      }
      const target = joinPath(parentPath(path), newName.trim());
      if (target === path) return;
      await ensureAbsent(target);
      await io('rename', path, () => backend.rename(path, target));
    },

    async move(rawSource, rawDestination) {
      const { source, target } = await transferTarget(rawSource, rawDestination, 'move');
      await io('move', source, () => backend.rename(source, target));
    },

    async copy(rawSource, rawDestination) {
      const { source, target } = await transferTarget(rawSource, rawDestination, 'copy');
      await io('copy', source, () => backend.copy(source, target));
    },

    async delete(rawPath) {
      const path = resolveInRoot(rawPath);
      notRoot(path, 'delete');
      await existing(path);
      await io('delete', path, () => backend.remove(path));
    },
  };
}
