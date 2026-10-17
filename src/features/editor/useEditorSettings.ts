import { useSyncExternalStore } from 'react';
import { useServices } from '../../app/services';
import type { EditorSettings } from './editorSettings';

/** The editor's settings (#45), kept in step with the store. */
export function useEditorSettings(): EditorSettings {
  const { editorSettings } = useServices();
  return useSyncExternalStore(editorSettings.subscribe, editorSettings.get);
}
