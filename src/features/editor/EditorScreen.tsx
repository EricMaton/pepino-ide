import { App as CapacitorApp } from '@capacitor/app';
import { Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorViewState } from '../../app/session';

import { useServices } from '../../app/services';
import { TopBar } from '../../app/TopBar';
import { useBackHandler } from '../../ui/back';
import { Button, Dialog } from '../../ui/components';
import { cx } from '../../ui/cx';
import { BackIcon } from '../../ui/icons';
import { useSnackbar } from '../../ui/useSnackbar';
import { errorMessage } from '../projects/errors';
import { fileBadge } from '../projects/files';
import { basename } from '../projects/paths';
import { CodeEditor } from './CodeEditor';
import styles from './EditorScreen.module.css';
import { EditorToolbar } from './EditorToolbar';
import { languageFor } from './languages';
import { takeSnapshot } from './snapshots';
import { detectLineSeparator, type LineSeparator, serialize } from './text';
import { DEFAULT_TOOLBAR } from './toolbar';

/** Quiet time after the last keystroke before autosaving. */
const AUTOSAVE_DELAY_MS = 1000;

type Loaded = { kind: 'text'; text: string } | { kind: 'binary' } | { kind: 'error'; message: string };
type SaveState = 'saved' | 'unsaved' | 'saving' | 'failed';

interface EditorScreenProps {
  path: string;
  /** False while another tab is showing: the editor stays mounted (keeping edits) but hidden. */
  visible: boolean;
  /** Breadcrumb-style folder label shown under the file name. */
  folderLabel: string;
  onClose: () => void;
  /** Where the cursor and scroll were last time this file was open. */
  initialViewState?: EditorViewState;
  /** Cursor/scroll changes, batched (at most every 400 ms) and flushed when leaving. */
  onViewState?: (state: EditorViewState) => void;
}

const VIEW_STATE_DELAY_MS = 400;

/**
 * Full-height editor for one file, laid over the explorer so closing it
 * returns to the same folder. Work is never lost: edits autosave shortly
 * after typing stops and whenever the app goes to the background, and the
 * file's previous content is snapshotted before it is first overwritten.
 */
export default function EditorScreen({
  path,
  visible,
  folderLabel,
  onClose,
  initialViewState,
  onViewState,
}: EditorScreenProps) {
  const { projectSpace, registry, dispatcher, events } = useServices();
  const showSnackbar = useSnackbar();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [editCount, setEditCount] = useState(0);
  const [confirmClose, setConfirmClose] = useState(false);
  const [view, setView] = useState<EditorView | null>(null);
  const doc = useRef<Text | null>(null);
  const savedDoc = useRef<Text | null>(null);
  const opened = useRef<{ text: string; doc: Text; separator: LineSeparator } | null>(null);
  const snapshotTaken = useRef(false);
  const saveQueue = useRef<Promise<boolean>>(Promise.resolve(true));
  const name = basename(path);
  const pendingViewState = useRef<EditorViewState | null>(null);
  const viewStateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reportViewState = useRef(onViewState);
  useEffect(() => {
    reportViewState.current = onViewState;
  });

  const flushViewState = useCallback(() => {
    clearTimeout(viewStateTimer.current);
    if (pendingViewState.current) reportViewState.current?.(pendingViewState.current);
    pendingViewState.current = null;
  }, []);

  const queueViewState = useCallback(
    (state: EditorViewState) => {
      pendingViewState.current = state;
      clearTimeout(viewStateTimer.current);
      viewStateTimer.current = setTimeout(flushViewState, VIEW_STATE_DELAY_MS);
    },
    [flushViewState],
  );

  // Never lose the last position when the editor closes.
  useEffect(() => flushViewState, [flushViewState]);
  const dirty = saveState !== 'saved';

  useEffect(() => {
    let active = true;
    projectSpace.readTextFile(path).then(
      (text) => {
        if (!active) return;
        // A NUL byte means this is not text; editing it would corrupt the file.
        if (text.includes('\u0000')) {
          setLoaded({ kind: 'binary' });
          return;
        }
        const openedDoc = Text.of(text.split(/\r\n?|\n/));
        opened.current = { text, doc: openedDoc, separator: detectLineSeparator(text) };
        savedDoc.current = openedDoc;
        setLoaded({ kind: 'text', text });
        events.publish('file.opened', { path });
      },
      (error: unknown) => {
        if (active) setLoaded({ kind: 'error', message: errorMessage(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [projectSpace, events, path]);

  const writeNow = useCallback(async (): Promise<boolean> => {
    const current = doc.current;
    const original = opened.current;
    if (!current || !original || (savedDoc.current && current.eq(savedDoc.current))) return true;
    setSaveState('saving');
    try {
      if (!snapshotTaken.current) {
        // A failed snapshot must not cost the user their edits: log it and save anyway.
        await takeSnapshot(projectSpace, path, original.text).catch((error: unknown) =>
          console.error(`Cannot snapshot ${path}`, error),
        );
        snapshotTaken.current = true;
      }
      await projectSpace.writeTextFile(path, serialize(current, original.separator));
      savedDoc.current = current;
      setSaveState(doc.current && !doc.current.eq(current) ? 'unsaved' : 'saved');
      events.publish('file.saved', { path });
      return true;
    } catch (error) {
      setSaveState('failed');
      showSnackbar(`Error: ${errorMessage(error)}`);
      return false;
    }
  }, [projectSpace, events, path, showSnackbar]);

  /** Saves pending edits; saves run one after another, never in parallel. */
  const save = useCallback((): Promise<boolean> => {
    saveQueue.current = saveQueue.current.then(writeNow, writeNow);
    return saveQueue.current;
  }, [writeNow]);

  // Autosave once typing pauses.
  useEffect(() => {
    if (saveState !== 'unsaved') return;
    const timer = setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [saveState, editCount, save]);

  // The OS may kill a backgrounded app at any moment: save the instant it leaves the foreground.
  useEffect(() => {
    const flush = () => {
      flushViewState();
      void save();
    };
    const onVisibility = () => document.visibilityState === 'hidden' && flush();
    const pause = CapacitorApp.addListener('pause', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      void pause.then((handle) => handle.remove());
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [save, flushViewState]);

  const requestClose = useCallback(async () => {
    if (!dirty || (await save())) onClose();
    else setConfirmClose(true);
  }, [dirty, save, onClose]);

  const revertToOpened = useCallback(() => {
    const original = opened.current;
    if (!view || !original) return;
    // A normal (undoable) edit, saved like any other.
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: original.doc }, userEvent: 'revert' });
  }, [view]);

  useBackHandler(visible && !confirmClose, () => void requestClose());

  // Hardware keyboards: Ctrl/Cmd+S saves while the editor is showing, even when focus is elsewhere.
  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [visible, save]);

  useEffect(() => {
    if (!visible) return;
    const disposers = [
      registry.register({ id: 'editor.save', title: `Save ${name}`, run: () => void save() }),
      registry.register({ id: 'editor.close', title: `Close ${name}`, run: () => void requestClose() }),
      registry.register({ id: 'editor.revert', title: `Revert ${name} to the opened version`, run: revertToOpened }),
    ];
    return () => disposers.forEach((dispose) => dispose());
  }, [registry, visible, name, save, requestClose, revertToOpened]);

  // Toolbar keys are commands, registered while this editor is the one showing.
  useEffect(() => {
    if (!visible || !view) return;
    const disposers = DEFAULT_TOOLBAR.map((key) =>
      registry.register({ id: key.id, title: key.title, hidden: key.hidden, run: () => key.run(view) }),
    );
    return () => disposers.forEach((dispose) => dispose());
  }, [registry, visible, view]);

  const runKey = (id: string) =>
    dispatcher.execute(id).catch((error: unknown) => showSnackbar(`Error: ${errorMessage(error)}`));

  const onChange = (next: Text) => {
    doc.current = next;
    const clean = savedDoc.current !== null && next.eq(savedDoc.current);
    setSaveState((state) => (clean ? 'saved' : state === 'saving' ? 'saving' : 'unsaved'));
    setEditCount((count) => count + 1);
  };

  const language = languageFor(name);

  return (
    <section className={styles.screen} hidden={!visible} aria-label={`Editor: ${name}`}>
      {visible && (
        <TopBar
          layer="overlay"
          leading={
            <Button square onClick={() => void requestClose()} aria-label="Close file">
              <BackIcon size={20} />
            </Button>
          }
          title={
            <>
              <span className="ellipsis">{name}</span>
              {dirty && <span className={styles.dirty} role="img" aria-label="Unsaved changes" />}
            </>
          }
          subtitle={`${folderLabel} · ${language?.label.toUpperCase() ?? fileBadge(name)}`}
          prefer="editor."
          label={`Search commands · ${name}`}
          trailing={
            saveState === 'failed' ? (
              <Button variant="filled" onClick={() => void save()}>
                Retry
              </Button>
            ) : (
              <span
                className={cx(
                  'label',
                  styles.saveState,
                  saveState === 'saving' && 'cursor',
                  saveState === 'saved' && 'muted',
                )}
                role="status"
              >
                {saveState === 'saved' ? 'Saved' : saveState === 'saving' ? 'Saving' : 'Unsaved'}
              </span>
            )
          }
        />
      )}

      {loaded === null ? (
        <p className={cx('label', 'cursor', styles.message)}>Opening</p>
      ) : loaded.kind === 'text' ? (
        <>
          <CodeEditor
            key={path}
            className={styles.editor}
            fileName={name}
            initialDoc={loaded.text}
            onChange={onChange}
            onReady={setView}
            initialViewState={initialViewState}
            onViewState={queueViewState}
          />
          <EditorToolbar keys={DEFAULT_TOOLBAR} onRun={runKey} />
        </>
      ) : (
        <div className={styles.message}>
          <p className="title">{loaded.kind === 'binary' ? 'Binary file' : "Can't open file"}</p>
          <p className="caption muted">{loaded.kind === 'binary' ? 'Pepino only edits text files.' : loaded.message}</p>
        </div>
      )}

      {confirmClose && (
        <Dialog
          title="Couldn't save"
          eyebrow={`FILE · ${name}`}
          onClose={() => setConfirmClose(false)}
          actions={
            <>
              <Button variant="text" tone="danger" onClick={onClose}>
                Discard
              </Button>
              <Button
                variant="filled"
                onClick={async () => {
                  if (await save()) onClose();
                }}
              >
                Retry
              </Button>
            </>
          }
        >
          <p className="body">
            <strong>{name}</strong> has changes that could not be saved. Discarding loses them.
          </p>
        </Dialog>
      )}
    </section>
  );
}
