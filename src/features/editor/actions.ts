import { indentUnit } from '@codemirror/language';
import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state';

/** Inserts [text] at every cursor, replacing selections, with the cursor after it. */
export function insertText(state: EditorState, text: string): TransactionSpec {
  return { ...state.replaceSelection(text), scrollIntoView: true, userEvent: 'input.type' };
}

/**
 * `{}`-style keys: with an empty cursor inserts the pair and leaves the cursor
 * between them; with a selection wraps it and keeps it selected.
 */
export function insertPair(state: EditorState, open: string, close: string): TransactionSpec {
  return {
    ...state.changeByRange((range) => {
      if (range.empty) {
        return {
          changes: { from: range.from, insert: open + close },
          range: EditorSelection.cursor(range.from + open.length),
        };
      }
      return {
        changes: [
          { from: range.from, insert: open },
          { from: range.to, insert: close },
        ],
        range: EditorSelection.range(range.from + open.length, range.to + open.length),
      };
    }),
    scrollIntoView: true,
    userEvent: 'input.type',
  };
}

/**
 * The TAB key: at a cursor, inserts the indent unit (spaces, never a literal
 * tab); with a selection, returns null so the caller indents the lines instead.
 */
export function insertIndent(state: EditorState): TransactionSpec | null {
  if (state.selection.ranges.some((range) => !range.empty)) return null;
  return insertText(state, state.facet(indentUnit));
}

/**
 * A plugin's snippet (#53) where the main selection is, replacing it: each
 * `\t` is one indent unit (the user's spaces or tab), each line after the
 * first starts at the indentation of the line it goes into, and the cursor
 * ends at `$0` (or after the snippet).
 */
export function insertSnippet(state: EditorState, body: string): TransactionSpec {
  const { from, to } = state.selection.main;
  const base = /^[ \t]*/.exec(state.doc.lineAt(from).text)![0];
  const lines = body
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, state.facet(indentUnit))
    .split('\n')
    .map((line, i) => (i === 0 || line === '' ? line : base + line));
  let text = lines.join('\n');
  const marker = text.indexOf('$0');
  if (marker >= 0) text = text.slice(0, marker) + text.slice(marker + 2);
  return {
    changes: { from, to, insert: text },
    selection: EditorSelection.cursor(from + (marker >= 0 ? marker : text.length)),
    scrollIntoView: true,
    userEvent: 'input.paste',
  };
}
