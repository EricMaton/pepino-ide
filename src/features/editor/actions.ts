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
