import { useEffect, useRef } from 'react';
import { useServices } from '../../app/services';
import { parentPath } from './paths';

/**
 * Calls [onChange] whenever something directly inside [folder] is created,
 * written, moved in or out, or deleted — from anywhere in the app (explorer,
 * editor, workspace API, plugins).
 */
export function useFolderChanges(folder: string | null, onChange: () => void): void {
  const { events } = useServices();
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });

  useEffect(() => {
    if (folder === null) return;
    const touches = (path: string) => parentPath(path) === folder;
    const notify = (path: string) => touches(path) && latest.current();
    const disposers = [
      events.subscribe('fs.created', ({ path }) => notify(path)),
      events.subscribe('fs.written', ({ path }) => notify(path)),
      events.subscribe('fs.deleted', ({ path }) => notify(path)),
      events.subscribe('fs.moved', ({ from, to }) => (touches(from) || touches(to)) && latest.current()),
    ];
    return () => disposers.forEach((dispose) => dispose());
  }, [events, folder]);
}
