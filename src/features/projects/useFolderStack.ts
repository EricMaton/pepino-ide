import { useState } from 'react';
import { useBackHandler } from '../../ui/back';
import { joinPath } from './paths';

/** [rootPath] and every folder down to [start] (inside it): the way a walk to [start] would have gone. */
export function stackTo(rootPath: string, start: string): string[] {
  const stack = [rootPath];
  const below = start === rootPath ? '' : rootPath === '' ? start : start.slice(rootPath.length + 1);
  for (const segment of below.split('/').filter(Boolean)) stack.push(joinPath(stack[stack.length - 1], segment));
  return stack;
}

/** The folders walked into from [rootPath] (already down to [start]), one level at a time; back goes up one. */
export function useFolderStack(rootPath: string, start = rootPath) {
  const [stack, setStack] = useState<string[]>(() => stackTo(rootPath, start));
  const canGoUp = stack.length > 1;
  const goUp = () => setStack((current) => (current.length > 1 ? current.slice(0, -1) : current));
  useBackHandler(canGoUp, goUp);
  return {
    stack,
    /** The folder being looked at. */
    path: stack[stack.length - 1],
    canGoUp,
    goUp,
    enter: (path: string) => setStack((current) => [...current, path]),
    jump: (depth: number) => setStack((current) => current.slice(0, depth + 1)),
  };
}

export type FolderStack = ReturnType<typeof useFolderStack>;
