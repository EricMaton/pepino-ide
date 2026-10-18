import { PAGE_FILE, PERMISSIONS, type Permission } from './manifest';

/*
 * The plugins that can be installed (#55, #56): EricMaton/pepino-plugins on
 * GitHub, no backend of its own. Its index.json lists each plugin with its
 * permissions and the SHA-256 of its files; a plugin is downloaded file by
 * file, and each file is checked against its hash before anything is kept.
 */

export const REGISTRY_URL = 'https://raw.githubusercontent.com/EricMaton/pepino-plugins/main/';

/** The files a plugin is made of: plugin.json (the only one it must have), main.js, and its pages' HTML (#185). */
const isPluginFile = (name: string) => name === 'plugin.json' || name === 'main.js' || PAGE_FILE.test(name);

export interface RegistryEntry {
  id: string;
  name: string;
  version: string;
  apiVersion: string;
  description?: string;
  permissions: Permission[];
  /** Its folder in the repository: `plugins/<folder>`. */
  path: string;
  /** Each of its files, by name, and its SHA-256 (hex). */
  files: Record<string, string>;
}

/** A plugin as downloaded: what an installed one is made of. */
export interface PluginFilesContent {
  manifest: string;
  /** Empty for a plugin without main.js. */
  main: string;
  /** Its pages' HTML, by file name (#185). */
  assets?: Record<string, string>;
}

export interface PluginRegistry {
  /** Every plugin listed, newest index (the network). */
  list(): Promise<RegistryEntry[]>;
  /** [entry]'s files, each checked against its hash. */
  download(entry: RegistryEntry): Promise<PluginFilesContent>;
}

const SHA256 = /^[0-9a-f]{64}$/;
const PATH = /^plugins\/[A-Za-z0-9._-]+$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** index.json's plugins; an entry that does not hold is left out (with a warning), not the whole index. */
export function parseIndex(text: string): RegistryEntry[] {
  const raw: unknown = JSON.parse(text);
  if (!isObject(raw) || raw.schema !== 1 || !Array.isArray(raw.plugins)) {
    throw new Error('The plugins index is not one this Pepino reads');
  }
  const entries: RegistryEntry[] = [];
  for (const item of raw.plugins) {
    const files = isObject(item) && isObject(item.files) ? item.files : null;
    const valid =
      isObject(item) &&
      typeof item.id === 'string' &&
      typeof item.name === 'string' &&
      typeof item.version === 'string' &&
      typeof item.apiVersion === 'string' &&
      typeof item.path === 'string' &&
      PATH.test(item.path) &&
      !item.path.split('/').includes('..') &&
      Array.isArray(item.permissions) &&
      item.permissions.every((permission) => (PERMISSIONS as readonly unknown[]).includes(permission)) &&
      files !== null &&
      typeof files['plugin.json'] === 'string' &&
      Object.entries(files).every(
        ([name, hash]) => isPluginFile(name) && typeof hash === 'string' && SHA256.test(hash),
      );
    if (!valid) {
      console.warn('Plugins index: an entry left out', item);
      continue;
    }
    entries.push({
      id: item.id as string,
      name: item.name as string,
      version: item.version as string,
      apiVersion: item.apiVersion as string,
      ...(typeof item.description === 'string' && { description: item.description }),
      permissions: item.permissions as Permission[],
      path: item.path as string,
      files: files as Record<string, string>,
    });
  }
  return entries;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createRegistry(
  fetcher: typeof fetch = (...args) => fetch(...args),
  base = REGISTRY_URL,
): PluginRegistry {
  const get = async (path: string) => {
    let response: Response;
    try {
      response = await fetcher(new URL(path, base).toString(), { cache: 'no-cache' });
    } catch {
      throw new Error('Cannot reach the plugins repository: are you online?');
    }
    if (!response.ok) throw new Error(`The plugins repository answered ${response.status} for ${path}`);
    return response.text();
  };

  return {
    async list() {
      return parseIndex(await get('index.json'));
    },
    async download(entry) {
      const fetched = await Promise.all(
        Object.entries(entry.files).map(async ([name, hash]) => {
          const text = await get(`${entry.path}/${name}`);
          if ((await sha256(text)) !== hash) {
            throw new Error(`${entry.name}: ${name} is not the file the index lists; nothing was installed`);
          }
          return [name, text] as const;
        }),
      );
      const files = Object.fromEntries(fetched);
      const { 'plugin.json': manifest, 'main.js': main, ...assets } = files;
      return { manifest, main: main ?? '', assets };
    },
  };
}
