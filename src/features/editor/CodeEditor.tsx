import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, type Text } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { useEffect, useRef } from 'react';
import { languageFor } from './languages';
import { pepinoEditorTheme, pepinoHighlight } from './theme';

interface CodeEditorProps {
  fileName: string;
  initialDoc: string;
  /** Called on every edit with the new document. */
  onChange: (doc: Text) => void;
  className?: string;
}

/**
 * CodeMirror 6 view (ADR-005). The view is created once per mount; remount
 * (with a `key`) to open another file. The grammar for [fileName] is loaded
 * after the first paint so big language packages never delay opening a file.
 */
export function CodeEditor({ fileName, initialDoc, onChange, className }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onChange });
  useEffect(() => {
    callbacks.current = { onChange };
  });

  useEffect(() => {
    const language = new Compartment();
    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        doc: initialDoc,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          highlightSelectionMatches(),
          syntaxHighlighting(pepinoHighlight),
          pepinoEditorTheme,
          EditorView.lineWrapping,
          EditorState.tabSize.of(2),
          indentUnit.of('  '),
          // Mobile keyboards: no auto-capitalisation or autocorrect inside code.
          EditorView.contentAttributes.of({ autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' }),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callbacks.current.onChange(update.state.doc);
          }),
          language.of([]),
        ],
      }),
    });

    let active = true;
    languageFor(fileName)
      ?.load()
      .then((extension) => {
        if (active) view.dispatch({ effects: language.reconfigure(extension) });
      })
      .catch((error: unknown) => console.error(`Cannot load grammar for ${fileName}`, error));

    return () => {
      active = false;
      view.destroy();
    };
    // The view owns its document after creation; changing props must not rebuild it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={hostRef} className={className} />;
}
