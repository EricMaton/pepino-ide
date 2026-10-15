import { EditorSelection, EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { indentUnit } from '@codemirror/language';
import { insertIndent, insertPair, insertText } from './actions';

/** `|` marks the cursor, `[…]` a selection. */
function stateFrom(marked: string): EditorState {
  const selections: Array<{ anchor: number; head?: number }> = [];
  let doc = '';
  for (let i = 0; i < marked.length; i++) {
    const char = marked[i];
    if (char === '|') selections.push({ anchor: doc.length });
    else if (char === '[') selections.push({ anchor: doc.length, head: -1 });
    else if (char === ']') selections[selections.length - 1].head = doc.length;
    else doc += char;
  }
  return EditorState.create({
    doc,
    selection: EditorSelection.create(
      selections.map(({ anchor, head }) => EditorSelection.range(anchor, head ?? anchor)),
    ),
    extensions: EditorState.allowMultipleSelections.of(true),
  });
}

function marked(state: EditorState): string {
  let out = state.doc.toString();
  for (const range of [...state.selection.ranges].reverse()) {
    out = range.empty
      ? `${out.slice(0, range.from)}|${out.slice(range.from)}`
      : `${out.slice(0, range.from)}[${out.slice(range.from, range.to)}]${out.slice(range.to)}`;
  }
  return out;
}

const apply = (state: EditorState, spec: ReturnType<typeof insertText>) => marked(state.update(spec).state);

describe('insertText', () => {
  it('inserts at the cursor and moves past it', () => {
    expect(apply(stateFrom('a|b'), insertText(stateFrom('a|b'), ';'))).toBe('a;|b');
  });

  it('replaces the selection', () => {
    const state = stateFrom('a[bc]d');
    expect(apply(state, insertText(state, '='))).toBe('a=|d');
  });

  it('works on every cursor', () => {
    const state = stateFrom('x|\ny|');
    expect(apply(state, insertText(state, ';'))).toBe('x;|\ny;|');
  });
});

describe('insertPair', () => {
  it('leaves the cursor inside an empty pair', () => {
    const state = stateFrom('f|');
    expect(apply(state, insertPair(state, '(', ')'))).toBe('f(|)');
  });

  it('wraps and keeps the selection', () => {
    const state = stateFrom('const a = [b + c];');
    expect(apply(state, insertPair(state, '(', ')'))).toBe('const a = ([b + c]);');
  });

  it('handles multi-character delimiters and several ranges', () => {
    const state = stateFrom('[a] |');
    expect(apply(state, insertPair(state, '<', '>'))).toBe('<[a]> <|>');
  });
});

describe('insertIndent', () => {
  it('inserts the indent unit as spaces at the cursor', () => {
    const state = EditorState.create({ doc: 'x', extensions: indentUnit.of('  ') });
    expect(state.update(insertIndent(state)!).state.doc.toString()).toBe('  x');
  });

  it('leaves selections to line indentation', () => {
    const state = stateFrom('[a]');
    expect(insertIndent(state)).toBeNull();
  });
});
