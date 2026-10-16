import { useState } from 'react';
import { useBackHandler } from '../../ui/back';

/** The folders walked into from [rootPath], one level at a time; back goes up one. */
export function useFolderStack(rootPath: string) {
  const [stack, setStack] = useState<string[]>([rootPath]);
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
