/*
 * Saves still running, by path. An editor that closes by unmounting (another file
 * opened, another project) saves in the background; reopening the same file must
 * wait for that save, or it would load the old content and could later write it back.
 */
const pending = new Map<string, Promise<unknown>>();

/** Records [save] as the latest save of [path] until it settles. */
export function trackSave(path: string, save: Promise<unknown>): void {
  pending.set(path, save);
  const forget = () => {
    if (pending.get(path) === save) pending.delete(path);
  };
  save.then(forget, forget);
}

/** Resolves once the latest save of [path] has finished, whether it worked or not. */
export function saveSettled(path: string): Promise<void> {
  const save = pending.get(path);
  return save
    ? save.then(
        () => undefined,
        () => undefined,
      )
    : Promise.resolve();
}
