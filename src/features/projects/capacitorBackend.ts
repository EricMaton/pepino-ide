import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import type { FsBackend } from './projectSpace';

const ROOT = 'projects';
const directory = Directory.Data;

const full = (path: string) => (path === '' ? ROOT : `${ROOT}/${path}`);

/**
 * Project space stored under the app's private data dir (`filesDir/projects`
 * on Android). On the web, Capacitor backs this with IndexedDB, so `npm run dev`
 * works against the same code path.
 */
export function createCapacitorBackend(): FsBackend {
  return {
    async stat(path) {
      try {
        const stat = await Filesystem.stat({ path: full(path), directory });
        const isDirectory = stat.type === 'directory';
        return { isDirectory, sizeBytes: isDirectory ? 0 : stat.size, modifiedMillis: stat.mtime };
      } catch {
        return null;
      }
    },

    async list(path) {
      const { files } = await Filesystem.readdir({ path: full(path), directory });
      return files.map((file) => ({
        name: file.name,
        isDirectory: file.type === 'directory',
        sizeBytes: file.size,
        modifiedMillis: file.mtime,
      }));
    },

    async mkdir(path) {
      await Filesystem.mkdir({ path: full(path), directory, recursive: path === '' });
    },

    async readText(path) {
      const { data } = await Filesystem.readFile({ path: full(path), directory, encoding: Encoding.UTF8 });
      return typeof data === 'string' ? data : await data.text();
    },

    async writeText(path, text) {
      await Filesystem.writeFile({ path: full(path), directory, data: text, encoding: Encoding.UTF8 });
    },

    async rename(from, to) {
      await Filesystem.rename({ from: full(from), to: full(to), directory, toDirectory: directory });
    },

    async copy(from, to) {
      await Filesystem.copy({ from: full(from), to: full(to), directory, toDirectory: directory });
    },

    async remove(path) {
      const stat = await Filesystem.stat({ path: full(path), directory });
      if (stat.type === 'directory') {
        await Filesystem.rmdir({ path: full(path), directory, recursive: true });
      } else {
        await Filesystem.deleteFile({ path: full(path), directory });
      }
    },
  };
}
