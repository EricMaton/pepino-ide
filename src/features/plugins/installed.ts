import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import type { PluginSource } from './loader';
import type { PluginFilesContent } from './registry';

/*
 * The plugins installed from the repository (#56), kept in the app's own
 * data (filesDir/plugins/<id>/plugin.json and main.js on Android), and
 * listed as a source of plugins like the ones that come with Pepino.
 */
export interface InstalledPlugins extends PluginSource {
  save(id: string, files: PluginFilesContent): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Where they are kept: a folder per plugin, by id. */
export interface PluginFolders {
  ids(): Promise<string[]>;
  read(id: string): Promise<PluginFilesContent | null>;
  write(id: string, files: PluginFilesContent): Promise<void>;
  remove(id: string): Promise<void>;
}

export function installedPlugins(folders: PluginFolders): InstalledPlugins {
  return {
    async list() {
      const found = await Promise.all(
        (await folders.ids()).map(async (id) => {
          const files = await folders.read(id);
          return files && { origin: `installed:${id}`, manifest: files.manifest, main: files.main, builtin: false };
        }),
      );
      return found.filter((plugin) => plugin !== null);
    },
    save: (id, files) => folders.write(id, files),
    remove: (id) => folders.remove(id),
  };
}

const ROOT = 'plugins';
const directory = Directory.Data;

/** filesDir/plugins/<id>/ (IndexedDB on the web). */
export function capacitorPluginFolders(): PluginFolders {
  const read = async (path: string): Promise<string | null> => {
    try {
      const { data } = await Filesystem.readFile({ path, directory, encoding: Encoding.UTF8 });
      return typeof data === 'string' ? data : await data.text();
    } catch {
      return null;
    }
  };
  return {
    async ids() {
      try {
        const { files } = await Filesystem.readdir({ path: ROOT, directory });
        return files.filter((file) => file.type === 'directory').map((file) => file.name);
      } catch {
        // Nothing installed yet
        return [];
      }
    },
    async read(id) {
      const manifest = await read(`${ROOT}/${id}/plugin.json`);
      return manifest === null ? null : { manifest, main: (await read(`${ROOT}/${id}/main.js`)) ?? '' };
    },
    async write(id, files) {
      // A new version replaces the old one whole
      await Filesystem.rmdir({ path: `${ROOT}/${id}`, directory, recursive: true }).catch(() => undefined);
      await Filesystem.mkdir({ path: `${ROOT}/${id}`, directory, recursive: true });
      await Filesystem.writeFile({
        path: `${ROOT}/${id}/plugin.json`,
        directory,
        data: files.manifest,
        encoding: Encoding.UTF8,
      });
      if (files.main !== '') {
        await Filesystem.writeFile({
          path: `${ROOT}/${id}/main.js`,
          directory,
          data: files.main,
          encoding: Encoding.UTF8,
        });
      }
    },
    async remove(id) {
      await Filesystem.rmdir({ path: `${ROOT}/${id}`, directory, recursive: true }).catch(() => undefined);
    },
  };
}

/** In memory: tests, and nowhere to keep them. */
export function memoryPluginFolders(): PluginFolders {
  const folders = new Map<string, PluginFilesContent>();
  return {
    ids: async () => [...folders.keys()],
    read: async (id) => folders.get(id) ?? null,
    write: async (id, files) => void folders.set(id, files),
    remove: async (id) => void folders.delete(id),
  };
}
