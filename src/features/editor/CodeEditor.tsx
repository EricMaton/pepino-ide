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
import { pinchFontSize } from './zoom';
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
  /** Font size in px; pinching with two fingers proposes a new one through [onFontSize]. */
  fontSize: number;
  /** [final] is true when the pinch ends (persist then). */
  onFontSize?: (size: number, final: boolean) => void;
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
  fontSize,
  onFontSize,
  className,
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const language = useRef(new Compartment());
  const fontTheme = useRef(new Compartment());
  const callbacks = useRef({ onChange, onReady, onViewState, onFontSize, fontSize });
  useEffect(() => {
    callbacks.current = { onChange, onReady, onViewState, onFontSize, fontSize };
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
          fontTheme.current.of(fontSizeTheme(fontSize)),
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

    // Two-finger pinch zooms the code (not the page); one finger keeps scrolling and selecting.
    let pinch: { startDistance: number; startSize: number; size: number } | null = null;
    const spread = (touches: TouchList) =>
      Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      const size = callbacks.current.fontSize;
      pinch = { startDistance: spread(event.touches), startSize: size, size };
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!pinch || event.touches.length !== 2) return;
      event.preventDefault();
      const size = pinchFontSize(pinch.startSize, pinch.startDistance, spread(event.touches));
      if (size !== pinch.size) {
        pinch.size = size;
        callbacks.current.onFontSize?.(size, false);
      }
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (!pinch || event.touches.length >= 2) return;
      callbacks.current.onFontSize?.(pinch.size, true);
      pinch = null;
    };
    view.scrollDOM.addEventListener('touchstart', onTouchStart, { passive: true });
    view.scrollDOM.addEventListener('touchmove', onTouchMove, { passive: false });
    view.scrollDOM.addEventListener('touchend', onTouchEnd, { passive: true });
    view.scrollDOM.addEventListener('touchcancel', onTouchEnd, { passive: true });

    viewRef.current = view;
    callbacks.current.onReady?.(view);

    return () => {
      viewRef.current = null;
      callbacks.current.onReady?.(null);
      view.scrollDOM.removeEventListener('scroll', reportViewState);
      view.scrollDOM.removeEventListener('touchstart', onTouchStart);
      view.scrollDOM.removeEventListener('touchmove', onTouchMove);
      view.scrollDOM.removeEventListener('touchend', onTouchEnd);
      view.scrollDOM.removeEventListener('touchcancel', onTouchEnd);
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

  // A theme change makes CodeMirror re-measure line heights, keeping the gutter aligned.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: fontTheme.current.reconfigure(fontSizeTheme(fontSize)) });
  }, [fontSize]);

  return <div ref={hostRef} className={className} />;
}

function fontSizeTheme(size: number) {
  return EditorView.theme({ '&': { fontSize: `${size}px` } });
}
