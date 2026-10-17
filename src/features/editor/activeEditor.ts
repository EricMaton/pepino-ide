/*
 * The editor on screen (#48), for what acts on "the editor" without being
 * part of it: plugins (api.editor.*). The editor showing
 * registers itself while it shows; the last one registered is current.
 */

export interface EditorHandle {
  /** The file, relative to the project space. */
  path: string;
  getText(): string;
  /** Replaces the whole text, as one edit (undoable). */
  setText(text: string): void;
  /** The text selected (the main selection), or ''. */
  getSelection(): string;
  /** [text] in place of the selection, the cursor after it. */
  insert(text: string): void;
  /** A snippet in place of the selection (#53): see insertSnippet in actions.ts. */
  insertSnippet(body: string): void;
}

export interface ActiveEditor {
  current(): EditorHandle | null;
  /** [handle] is current until the disposer runs (or another registers). */
  set(handle: EditorHandle): () => void;
}

export function createActiveEditor(): ActiveEditor {
  const stack: EditorHandle[] = [];
  return {
    current: () => stack.at(-1) ?? null,
    set(handle) {
      stack.push(handle);
      return () => {
        const at = stack.lastIndexOf(handle);
        if (at >= 0) stack.splice(at, 1);
      };
    },
  };
}
