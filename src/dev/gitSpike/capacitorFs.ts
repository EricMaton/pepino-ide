// Spike #21: isomorphic-git's promise fs on top of @capacitor/filesystem.
// Paths come in as "/<name>/..." and live under filesDir/projects/spike-git.
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Buffer } from 'buffer';

const ROOT = 'projects/spike-git';
const directory = Directory.Data;
const full = (path: string) => `${ROOT}${path === '/' ? '' : path}`;

interface Stat {
  type: 'file' | 'dir';
  mode: number;
  size: number;
  ino: number;
  mtimeMs: number;
  ctimeMs: number;
  uid: number;
  gid: number;
  dev: number;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

function makeStat(isDirectory: boolean, size: number, mtime: number, ctime?: number): Stat {
  return {
    type: isDirectory ? 'dir' : 'file',
    mode: isDirectory ? 0o40000 : 0o100644,
    size,
    ino: 0,
    mtimeMs: mtime,
    ctimeMs: ctime ?? mtime,
    uid: 1,
    gid: 1,
    dev: 1,
    isFile: () => !isDirectory,
    isDirectory: () => isDirectory,
    isSymbolicLink: () => false,
  };
}

function fsError(code: string, path: string, cause?: unknown): Error {
  const error = new Error(`${code}: ${path}${cause ? ` (${String(cause)})` : ''}`) as Error & { code: string };
  error.code = code;
  return error;
}

export interface FsCounters {
  calls: Record<string, number>;
  bridgeMs: number;
}

/** Counts calls per method and time spent waiting on the bridge, for the measurements. */
export const counters: FsCounters = { calls: {}, bridgeMs: 0 };
async function timed<T>(name: string, work: () => Promise<T>): Promise<T> {
  counters.calls[name] = (counters.calls[name] ?? 0) + 1;
  const start = performance.now();
  try {
    return await work();
  } finally {
    counters.bridgeMs += performance.now() - start;
  }
}

export function createCapacitorGitFs(options: { readThroughWebView: boolean; statCache: boolean }) {
  const stats = new Map<string, Stat>();
  let base: Promise<string> | null = null;
  const baseUrl = () =>
    (base ??= Filesystem.getUri({ path: ROOT, directory }).then(({ uri }) => Capacitor.convertFileSrc(uri)));
  const forget = (path: string) => {
    stats.delete(path);
    stats.delete(path.slice(0, path.lastIndexOf('/')) || '/');
  };

  const promises = {
    async readFile(path: string, opts?: string | { encoding?: string }) {
      const encoding = typeof opts === 'string' ? opts : opts?.encoding;
      let bytes: Uint8Array;
      if (options.readThroughWebView) {
        const url = (await baseUrl()) + path.split('/').map(encodeURIComponent).join('/');
        const response = await timed('readFile', () => fetch(url, { cache: 'no-store' }));
        if (!response.ok) throw fsError('ENOENT', path);
        bytes = new Uint8Array(await response.arrayBuffer());
      } else {
        const result = await timed('readFile', () => Filesystem.readFile({ path: full(path), directory })).catch(
          (cause: unknown) => {
            throw fsError('ENOENT', path, cause);
          },
        );
        bytes = Buffer.from(result.data as string, 'base64');
      }
      return encoding === 'utf8' ? new TextDecoder().decode(bytes) : Buffer.from(bytes);
    },

    async writeFile(path: string, data: string | Uint8Array) {
      forget(path);
      await timed('writeFile', () =>
        typeof data === 'string'
          ? Filesystem.writeFile({ path: full(path), directory, data, encoding: Encoding.UTF8 })
          : Filesystem.writeFile({ path: full(path), directory, data: Buffer.from(data).toString('base64') }),
      ).catch((cause: unknown) => {
        throw fsError('ENOENT', path, cause);
      });
    },

    async unlink(path: string) {
      forget(path);
      await timed('unlink', () => Filesystem.deleteFile({ path: full(path), directory })).catch((cause: unknown) => {
        throw fsError('ENOENT', path, cause);
      });
    },

    async readdir(path: string) {
      const { files } = await timed('readdir', () => Filesystem.readdir({ path: full(path), directory })).catch(
        (cause: unknown) => {
          throw fsError('ENOENT', path, cause);
        },
      );
      if (options.statCache) {
        const prefix = path === '/' ? '' : path;
        for (const file of files)
          stats.set(`${prefix}/${file.name}`, makeStat(file.type === 'directory', file.size, file.mtime, file.ctime));
      }
      return files.map((file) => file.name);
    },

    async mkdir(path: string) {
      forget(path);
      await timed('mkdir', () => Filesystem.mkdir({ path: full(path), directory })).catch((cause: unknown) => {
        throw fsError(
          /exist/i.test(String(cause)) && !/not exist/i.test(String(cause)) ? 'EEXIST' : 'ENOENT',
          path,
          cause,
        );
      });
    },

    async rmdir(path: string) {
      forget(path);
      await timed('rmdir', () => Filesystem.rmdir({ path: full(path), directory })).catch((cause: unknown) => {
        throw fsError(/empty/i.test(String(cause)) ? 'ENOTEMPTY' : 'ENOENT', path, cause);
      });
    },

    async stat(path: string): Promise<Stat> {
      const cached = stats.get(path);
      if (cached) return cached;
      const stat = await timed('stat', () => Filesystem.stat({ path: full(path), directory })).catch(
        (cause: unknown) => {
          throw fsError('ENOENT', path, cause);
        },
      );
      return makeStat(stat.type === 'directory', stat.size, stat.mtime, stat.ctime);
    },

    async lstat(path: string) {
      return promises.stat(path);
    },

    async readlink(path: string): Promise<string> {
      throw fsError('ENOENT', path);
    },

    /** No symlinks in @capacitor/filesystem: write the target as the file's content, as git does with core.symlinks=false. */
    async symlink(target: string, path: string) {
      await promises.writeFile(path, target);
    },

    async chmod() {},
  };
  return {
    promises,
    /** Drops cached stats; call before each operation so nothing stale leaks across. */
    reset: () => stats.clear(),
    /** Removes the whole spike folder. */
    wipe: () => Filesystem.rmdir({ path: ROOT, directory, recursive: true }).catch(() => undefined),
    ensureRoot: () => Filesystem.mkdir({ path: ROOT, directory, recursive: true }).catch(() => undefined),
  };
}
