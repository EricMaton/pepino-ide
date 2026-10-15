import { cursorCharLeft, cursorCharRight, indentMore, redo, undo } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import { insertIndent, insertPair, insertText } from './actions';

/**
 * One key of the editor toolbar. Each key is registered as a command
 * (`id`), so plugins can contribute their own keys through
 * `contributes.toolbar` and anything can trigger a key by id.
 */
export interface ToolbarKey {
  id: string;
  /** What the key shows. */
  label: string;
  /** Command palette title and accessible name. */
  title: string;
  /** Symbol keys stay out of the command palette. */
  hidden?: boolean;
  run: (view: EditorView) => void;
}

const symbol = (name: string, text: string): ToolbarKey => ({
  id: `editor.insert.${name}`,
  label: text,
  title: `Insert ${text}`,
  hidden: true,
  run: (view) => view.dispatch(insertText(view.state, text)),
});

const pair = (name: string, open: string, close: string): ToolbarKey => ({
  id: `editor.insert.${name}`,
  label: open + close,
  title: `Insert ${open}${close}`,
  hidden: true,
  run: (view) => view.dispatch(insertPair(view.state, open, close)),
});

export const DEFAULT_TOOLBAR: readonly ToolbarKey[] = [
  {
    id: 'editor.indent',
    label: 'TAB',
    title: 'Indent',
    run: (view) => {
      const spec = insertIndent(view.state);
      if (spec) view.dispatch(spec);
      else indentMore(view);
    },
  },
  { id: 'editor.undo', label: '↶', title: 'Undo', run: (view) => void undo(view) },
  { id: 'editor.redo', label: '↷', title: 'Redo', run: (view) => void redo(view) },
  { id: 'editor.cursorLeft', label: '←', title: 'Cursor left', hidden: true, run: (view) => void cursorCharLeft(view) },
  {
    id: 'editor.cursorRight',
    label: '→',
    title: 'Cursor right',
    hidden: true,
    run: (view) => void cursorCharRight(view),
  },
  pair('braces', '{', '}'),
  pair('brackets', '[', ']'),
  pair('parens', '(', ')'),
  pair('angles', '<', '>'),
  symbol('equals', '='),
  symbol('semicolon', ';'),
  symbol('colon', ':'),
  pair('doubleQuotes', '"', '"'),
  pair('singleQuotes', "'", "'"),
  pair('backticks', '`', '`'),
  symbol('slash', '/'),
  symbol('backslash', '\\'),
  symbol('pipe', '|'),
  symbol('ampersand', '&'),
  symbol('bang', '!'),
  symbol('question', '?'),
  symbol('minus', '-'),
  symbol('plus', '+'),
  symbol('star', '*'),
  symbol('underscore', '_'),
  symbol('hash', '#'),
  symbol('dollar', '$'),
  symbol('at', '@'),
  symbol('tilde', '~'),
  symbol('percent', '%'),
  symbol('caret', '^'),
];
