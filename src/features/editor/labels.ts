import { parentPath } from '../projects/paths';

/** "my-app/src" for a file in my-app/src, relative to the explorer root [rootPath] shown as [rootName]. */
export function folderLabelFor(path: string, rootPath: string, rootName: string): string {
  const folder = parentPath(path);
  const relative = rootPath === '' ? folder : folder.slice(rootPath.length + 1);
  return relative ? `${rootName}/${relative}` : rootName;
}
