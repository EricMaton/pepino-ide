import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { Compartment, EditorSelection, EditorState, type Extension, type Text } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { useEffect, useRef } from 'react';
import type { EditorViewState } from '../../app/session';
import { languageFor } from './languages';
import { pepinoEditorTheme, pepinoHighlight } from './theme';

interface CodeEditorProps {
  fileName: string;
  initialDoc: string;
  /** Called on every edit with the new document. */
  onChange: (doc: Text) => void;
  /** Receives the view once created, and null when it is destroyed. */
  onReady?: (view: EditorView | null) => void;
  /** Cursor/selection and scroll to start from (clamped to the document). */
  initialViewState?: EditorViewState;
  /** Called when the selection moves or the editor scrolls. */
  onViewState?: (state: EditorViewState) => void;
  className?: string;
}

/**
 * CodeMirror 6 view (ADR-005). The view is created once per mount; remount
 * (with a `key`) to open another file. The grammar for [fileName] is loaded
 * after the first paint so big language packages never delay opening a file.
 */
export function CodeEditor({
  fileName,
  initialDoc,
  onChange,
  onReady,
  initialViewState,
  onViewState,
  className,
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const language = useRef(new Compartment());
  const callbacks = useRef({ onChange, onReady, onViewState });
  useEffect(() => {
    callbacks.current = { onChange, onReady, onViewState };
  });

  useEffect(() => {
    const clamp = (position: number) => Math.max(0, Math.min(position, initialDoc.length));
    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        doc: initialDoc,
        selection: initialViewState
          ? EditorSelection.single(clamp(initialViewState.anchor), clamp(initialViewState.head))
          : undefined,
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
            if (update.docChanged || update.selectionSet) reportViewState();
          }),
          language.current.of([]),
        ],
      }),
    });

    function reportViewState() {
      const { anchor, head } = view.state.selection.main;
      callbacks.current.onViewState?.({ anchor, head, scrollTop: view.scrollDOM.scrollTop });
    }
    view.scrollDOM.addEventListener('scroll', reportViewState, { passive: true });
    if (initialViewState?.scrollTop) {
      // Scroll once CodeMirror has measured its content, or the offset is lost.
      const top = initialViewState.scrollTop;
      view.requestMeasure({ read: () => undefined, write: () => void (view.scrollDOM.scrollTop = top) });
    }

    viewRef.current = view;
    callbacks.current.onReady?.(view);

    return () => {
      viewRef.current = null;
      callbacks.current.onReady?.(null);
      view.scrollDOM.removeEventListener('scroll', reportViewState);
      view.destroy();
    };
    // The view owns its document after creation; changing props must not rebuild it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The grammar follows the file name (a rename from .ts to .py switches highlighting).
  useEffect(() => {
    let active = true;
    const definition = languageFor(fileName);
    const apply = (extension: Extension) => {
      if (active) viewRef.current?.dispatch({ effects: language.current.reconfigure(extension) });
    };
    if (!definition) apply([]);
    else definition.load().then(apply, (error: unknown) => console.error(`Cannot load grammar for ${fileName}`, error));
    return () => {
      active = false;
    };
  }, [fileName]);

  return <div ref={hostRef} className={className} />;
}
