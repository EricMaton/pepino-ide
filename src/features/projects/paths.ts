import { ProjectSpaceError } from './errors';

/**
 * Normalizes a root-relative path ('' is the root). Separators may be '/' or
 * '\'; '.' and empty segments are dropped. Any '..' that would climb above the
 * root fails, so the result always lives inside the project space.
 */
export function resolveInRoot(path: string): string {
  const segments: string[] = [];
  for (const segment of path.split(/[/\\]/)) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) {
        throw new ProjectSpaceError('EscapesRoot', `Path escapes project space: ${path}`);
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join('/');
}

export function joinPath(directory: string, name: string): string {
  return directory === '' ? name : `${directory}/${name}`;
}

export function basename(path: string): string {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? '';
}

export function parentPath(path: string): string {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  segments.pop();
  return segments.join('/');
}

/** True when [path] is [ancestor] or lives somewhere below it. */
export function isWithin(path: string, ancestor: string): boolean {
  return ancestor === '' || path === ancestor || path.startsWith(`${ancestor}/`);
}
