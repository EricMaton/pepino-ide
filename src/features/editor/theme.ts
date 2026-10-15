import { HighlightStyle } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

/*
 * Editor chrome and syntax colours, built only from the app's design tokens
 * so a theme (#44) restyles the editor too. Highlighting stays inside the
 * Pepino palette: red for structure (keywords), white for names, grey for
 * noise (comments, punctuation), and red/white mixes for literals.
 */
const lightRed = 'color-mix(in srgb, var(--primary) 55%, var(--fg))';
const rose = 'color-mix(in srgb, var(--fg) 72%, var(--primary))';
const dimFg = 'color-mix(in srgb, var(--fg) 82%, var(--outline))';

export const pepinoEditorTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      color: 'var(--fg)',
      backgroundColor: 'var(--bg)',
      fontSize: 'var(--editor-font-size, 14px)',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: 'var(--font-mono)',
      lineHeight: '1.6',
      fontVariantLigatures: 'none',
    },
    '.cm-content': { padding: 'var(--space-2) 0 50vh', caretColor: 'var(--primary)' },
    '.cm-line': { padding: '0 var(--space-3) 0 var(--space-2)' },
    '.cm-gutters': {
      backgroundColor: 'var(--surface-variant)',
      color: 'var(--outline)',
      borderRight: 'var(--stroke) solid var(--fg)',
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 var(--space-2) 0 var(--space-3)', minWidth: '3ch' },
    '.cm-activeLineGutter': { backgroundColor: 'var(--bg)', color: 'var(--primary)', fontWeight: '700' },
    '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--fg) 5%, transparent)' },
    '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--primary)' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'color-mix(in srgb, var(--primary) 38%, transparent) !important',
    },
    '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--fg) 14%, transparent)' },
    '&.cm-focused .cm-matchingBracket': {
      backgroundColor: 'transparent',
      outline: '1px solid var(--primary)',
      color: 'var(--fg)',
    },
    '.cm-nonmatchingBracket': { backgroundColor: 'var(--error)', color: 'var(--on-primary)' },
    '.cm-foldPlaceholder': { backgroundColor: 'var(--surface-variant)', border: 'none', color: 'var(--outline)' },
    '.cm-panels': { backgroundColor: 'var(--surface-variant)', color: 'var(--fg)' },
    '.cm-panels.cm-panels-top': { borderBottom: 'var(--stroke) solid var(--fg)' },
    '.cm-searchMatch': { outline: '1px solid var(--outline)' },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'color-mix(in srgb, var(--primary) 30%, transparent)',
    },
    '.cm-tooltip': { backgroundColor: 'var(--surface-variant)', border: 'var(--stroke) solid var(--fg)' },
  },
  { dark: true },
);

export const pepinoHighlight = HighlightStyle.define([
  {
    tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier],
    color: 'var(--primary)',
    fontWeight: '700',
  },
  { tag: [t.self, t.atom, t.bool, t.null, t.number, t.integer, t.float, t.unit], color: lightRed },
  { tag: [t.string, t.special(t.string), t.character, t.regexp, t.escape], color: rose },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--outline)', fontStyle: 'italic' },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)], color: 'var(--fg)', fontWeight: '700' },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.variableName)],
    color: 'var(--fg)',
    fontWeight: '600',
  },
  { tag: [t.propertyName, t.attributeName, t.labelName], color: dimFg },
  { tag: [t.punctuation, t.bracket, t.separator, t.operator, t.derefOperator], color: 'var(--outline)' },
  { tag: [t.tagName, t.meta, t.annotation, t.processingInstruction], color: 'var(--primary)' },
  { tag: t.heading, color: 'var(--primary)', fontWeight: '800' },
  { tag: t.strong, fontWeight: '800' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: rose, textDecoration: 'underline' },
  { tag: t.quote, color: 'var(--outline)' },
  { tag: t.invalid, color: 'var(--on-primary)', backgroundColor: 'var(--error)' },
]);
