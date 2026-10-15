import { useSyncExternalStore } from 'react';
import type { Workspace, WorkspaceState } from './workspace';

/** The workspace state, re-rendering whenever it changes. */
export function useWorkspaceState(workspace: Workspace): WorkspaceState {
  return useSyncExternalStore(workspace.subscribe, workspace.getState);
}
