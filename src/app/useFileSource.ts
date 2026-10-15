import { useMemo } from 'react';
import { errorMessage } from '../features/projects/errors';
import { useWorkspaceState } from '../features/workspace/useWorkspace';
import { useSnackbar } from '../ui/useSnackbar';
import type { FileSource } from './CommandSearch';
import { useServices } from './services';

/** The workspace as a file source for the top bar search: open files, fuzzy find, open in the editor. */
export function useFileSource(): FileSource {
  const { workspace } = useServices();
  const { root, openFiles } = useWorkspaceState(workspace);
  const showSnackbar = useSnackbar();
  return useMemo(
    () => ({
      root,
      recent: openFiles,
      find: (query: string) => workspace.findFiles(query),
      open: (path: string) => {
        workspace.openFile(path).catch((error: unknown) => showSnackbar(`Error: ${errorMessage(error)}`));
      },
    }),
    [workspace, root, openFiles, showSnackbar],
  );
}
