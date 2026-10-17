import { App as CapacitorApp } from '@capacitor/app';
import { Text, Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorViewState } from '../../app/session';

import { useServices } from '../../app/services';
import { TopBar } from '../../app/TopBar';
import { useFileSource } from '../../app/useFileSource';
import { useBackHandler } from '../../ui/back';
import { navigate } from '../../ui/motion';
import { saveSettled, trackSave } from './pendingSaves';
import { Button, Dialog } from '../../ui/components';
import { cx } from '../../ui/cx';
import { BackIcon, CloseIcon, HistoryIcon, TreeIcon } from '../../ui/icons';
import { useSnackbar } from '../../ui/useSnackbar';
import { errorMessage } from '../projects/errors';
import { fileBadge } from '../projects/files';
import { basename, isWithin } from '../projects/paths';
import { WorkspaceDrawer } from '../workspace/WorkspaceDrawer';
import { CodeEditor } from './CodeEditor';
import styles from './EditorScreen.module.css';
import { EditorToolbar } from './EditorToolbar';
import { languageFor } from './languages';
import { detectLineSeparator, type LineSeparator, serialize } from './text';
import { DEFAULT_TOOLBAR } from './toolbar';
import { VersionsView } from './VersionsView';
import { useEditorSettings } from './useEditorSettings';
import { DEFAULT_FONT_SIZE, ZOOM_STEP } from './zoom';

/** Quiet time after the last keystroke before autosaving. */
const AUTOSAVE_DELAY_MS = 1000;

type Loaded = { kind: 'text'; text: string } | { kind: 'binary' } | { kind: 'error'; message: string };
type SaveState = 'saved' | 'unsaved' | 'saving' | 'failed';

/** The workspace's open files, shown as tabs above the editor (this file is the active one). */
export interface EditorTabs {
  files: readonly string[];
  onSelect: (path: string) => void;
  /** Closes a tab other than this file's (already saved: only the active file has an editor). */
  onClose: (path: string) => void;
  /**
   * Out of the workspace to the explorer, its tabs still open: back with the tree showing.
   * [alongside] runs in the same screen change (the tree closing, so the file is what comes back).
   */
  onLeave: (alongside: () => void) => void;
}

interface EditorScreenProps {
  path: string;
  /** False while another screen is showing: the editor stays mounted (keeping edits) but hidden. */
  visible: boolean;
  /** Breadcrumb-style folder label shown under the file name. */
  folderLabel: string;
  /** The workspace's tabs, or null for a loose file (opened from the explorer, outside any workspace). */
  tabs: EditorTabs | null;
  /** This file is closed, after saving it (or the user discarding what could not be saved). */
  onClose: () => void;
  /** Where the cursor and scroll were last time this file was open. */
  initialViewState?: EditorViewState;
  /** Cursor/scroll changes, batched (at most every 400 ms) and flushed when leaving. */
  onViewState?: (state: EditorViewState) => void;
}

const VIEW_STATE_DELAY_MS = 400;

/**
 * Full-height editor for one file: the workspace's active tab, or a loose
 * file laid over the explorer so closing it returns to the same folder. Work
 * is never lost: edits autosave shortly after typing stops and whenever the
 * app goes to the background, and the file's previous content is
 * snapshotted before it is first overwritten.
 */
export default function EditorScreen({
  path,
  visible,
  folderLabel,
  tabs,
  onClose,
  initialViewState,
  onViewState,
}: EditorScreenProps) {
  const { projectSpace, registry, dispatcher, events, workspace, editorSettings, fileHistory, activeEditor } =
    useServices();
  const showSnackbar = useSnackbar();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [editCount, setEditCount] = useState(0);
  const [confirmClose, setConfirmClose] = useState(false);
  const [view, setView] = useState<EditorView | null>(null);
  const [filesOpen, setFilesOpenNow] = useState(false);
  // The tree slides over the editor and away again (ui/motion.ts).
  const setFilesOpen = useCallback((open: boolean) => navigate('drawer', () => setFilesOpenNow(open)), []);
  // "Earlier versions" laid over the editor (#27)
  const [versionsOpen, setVersionsOpenNow] = useState(false);
  const setVersionsOpen = useCallback(
    (open: boolean) => navigate(open ? 'forward' : 'back', () => setVersionsOpenNow(open)),
    [],
  );
  const files = useFileSource();
  // The editor's settings (#45), shared by every file: the font size changes by pinching, the Zoom
  // commands or SETTINGS; tabs, wrap and line numbers in SETTINGS
  const settings = useEditorSettings();
  const { fontSize } = settings;
  const changeFontSize = useCallback(
    (size: number, persist = true) => void editorSettings.set({ fontSize: size }, persist).catch(() => undefined),
    [editorSettings],
  );
  const inWorkspace = tabs !== null;
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

  // The file can be renamed or moved while open (workspace tree, plugins): writes always go to
  // the current path, and a deleted file is never written back.
  const livePath = useRef(path);
  const openedPath = useRef(path);
  const gone = useRef(false);
  useEffect(() => {
    livePath.current = path;
  });
  useEffect(
    () =>
      events.subscribe('fs.deleted', ({ path: deleted }) => {
        if (isWithin(livePath.current, deleted)) gone.current = true;
      }),
    [events],
  );

  // Loaded once per editing session; a rename keeps the document instead of reloading it.
  useEffect(() => {
    let active = true;
    const path = openedPath.current;
    // A save of this file may still be running (its editor just unmounted): read after it.
    saveSettled(path)
      .then(() => projectSpace.readTextFile(path))
      .then(
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
  }, [projectSpace, events]);

  const writeNow = useCallback(async (): Promise<boolean> => {
    const current = doc.current;
    const original = opened.current;
    const path = livePath.current;
    if (gone.current) return true;
    if (!current || !original || (savedDoc.current && current.eq(savedDoc.current))) return true;
    setSaveState('saving');
    try {
      if (!snapshotTaken.current) {
        // A failed snapshot must not cost the user their edits: log it and save anyway.
        await fileHistory
          .beforeOverwrite(path, original.text)
          .catch((error: unknown) => console.error(`Cannot snapshot ${path}`, error));
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
  }, [projectSpace, fileHistory, events, showSnackbar]);

  /** Saves pending edits; saves run one after another, never in parallel. */
  const save = useCallback((): Promise<boolean> => {
    saveQueue.current = saveQueue.current.then(writeNow, writeNow);
    trackSave(livePath.current, saveQueue.current);
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

  // Someone else rewrote the file (a branch switch, a plugin): show the new content, unless the
  // editor has edits of its own, which win (saving them is what the user expects).
  useEffect(
    () =>
      events.subscribe('fs.written', ({ path: written }) => {
        if (written !== livePath.current || !view) return;
        void projectSpace.readTextFile(written).then((text) => {
          const original = opened.current;
          const saved = savedDoc.current;
          if (!original || !saved || livePath.current !== written) return;
          if (serialize(saved, original.separator) === text) return; // our own save
          if (doc.current && !doc.current.eq(saved)) return; // unsaved edits win
          const next = Text.of(text.split(/\r\n?|\n/));
          opened.current = { text, doc: next, separator: detectLineSeparator(text) };
          savedDoc.current = next;
          snapshotTaken.current = false;
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: next },
            annotations: Transaction.addToHistory.of(false),
          });
        });
      }),
    [events, projectSpace, view],
  );

  /** The file's text now, unsaved edits included. */
  const currentText = useCallback(() => {
    const original = opened.current;
    if (!original) return '';
    return doc.current ? serialize(doc.current, original.separator) : original.text;
  }, []);

  // An earlier version comes back as an edit (undo takes it back), after the file as it is now is
  // saved and kept: restoring never loses what was there.
  const restoreVersion = useCallback(
    async (text: string) => {
      if (!view || !(await save())) return;
      await fileHistory
        .beforeOverwrite(livePath.current, currentText(), 'Before restoring an earlier version')
        .catch((error: unknown) => console.error(`Cannot keep ${livePath.current} before restoring`, error));
      snapshotTaken.current = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: Text.of(text.split(/\r\n?|\n/)) },
        userEvent: 'restore',
      });
      setVersionsOpen(false);
      showSnackbar('Earlier version restored: undo takes it back');
    },
    [view, save, fileHistory, currentText, setVersionsOpen, showSnackbar],
  );

  const revertToOpened = useCallback(() => {
    const original = opened.current;
    if (!view || !original) return;
    // A normal (undoable) edit, saved like any other.
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: original.doc }, userEvent: 'revert' });
  }, [view]);

  // Back goes up a level: from a workspace file to its tree (the file stays open), from a loose file
  // back to the explorer (closing it). With the tree showing, the tree's own back takes over.
  useBackHandler(visible && !confirmClose && !filesOpen && !versionsOpen, () =>
    inWorkspace ? setFilesOpen(true) : void requestClose(),
  );

  // Leaving this file any other way than "close" (opening another one from the tree, closing the
  // project) unmounts the editor: pending edits are written then, not lost.
  const latestSave = useRef(save);
  useEffect(() => {
    latestSave.current = save;
  });
  useEffect(() => () => void latestSave.current(), []);

  const openOther = (other: string) => {
    setFilesOpen(false);
    if (other === path) return;
    workspace.openFile(other).catch((error: unknown) => showSnackbar(`Error: ${errorMessage(error)}`));
  };

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
      registry.register({
        id: 'editor.versions',
        title: `Earlier versions of ${name}`,
        run: () => setVersionsOpen(true),
      }),
      ...(inWorkspace
        ? [registry.register({ id: 'editor.files', title: 'Project files', run: () => setFilesOpen(true) })]
        : []),
      registry.register({ id: 'editor.zoomIn', title: 'Zoom in', run: () => changeFontSize(fontSize + ZOOM_STEP) }),
      registry.register({ id: 'editor.zoomOut', title: 'Zoom out', run: () => changeFontSize(fontSize - ZOOM_STEP) }),
      registry.register({ id: 'editor.zoomReset', title: 'Reset zoom', run: () => changeFontSize(DEFAULT_FONT_SIZE) }),
    ];
    return () => disposers.forEach((dispose) => dispose());
  }, [
    registry,
    visible,
    inWorkspace,
    name,
    save,
    requestClose,
    revertToOpened,
    setVersionsOpen,
    fontSize,
    changeFontSize,
    setFilesOpen,
  ]);

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

  // While this editor shows, it is "the editor" for plugins (#48)
  useEffect(() => {
    if (!view || !visible) return;
    return activeEditor.set({
      get path() {
        return livePath.current;
      },
      getText: () => view.state.doc.toString(),
      setText: (text) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }),
    });
  }, [activeEditor, view, visible]);

  const onChange = (next: Text) => {
    doc.current = next;
    events.publish('editor.changed', { path: livePath.current });
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
          title={
            <>
              <span className="ellipsis">{name}</span>
              {dirty && <span className={styles.dirty} role="img" aria-label="Unsaved changes" />}
            </>
          }
          subtitle={`${folderLabel} · ${language?.label.toUpperCase() ?? fileBadge(name)}`}
          prefer="editor."
          files={files}
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

      {tabs ? (
        <TabBar
          tabs={tabs}
          active={path}
          dirty={dirty}
          onTree={() => setFilesOpen(true)}
          onCloseActive={() => void requestClose()}
          onVersions={() => setVersionsOpen(true)}
        />
      ) : (
        <div className={styles.tabBar}>
          <Button variant="text" square aria-label="Back" onClick={() => void requestClose()}>
            <BackIcon size={22} />
          </Button>
          <span className={cx('caption', 'muted', 'ellipsis', styles.looseLabel)}>
            <span className={styles.looseTag}>LOOSE FILE</span> · outside any workspace
          </span>
          <VersionsButton onClick={() => setVersionsOpen(true)} />
        </div>
      )}

      {loaded === null ? (
        <p className={cx('label', 'cursor', styles.message)} data-loading>
          Opening
        </p>
      ) : loaded.kind === 'text' ? (
        <>
          {/* No key: the view lives as long as the editing session, across renames. */}
          <CodeEditor
            className={styles.editor}
            fileName={name}
            initialDoc={loaded.text}
            onChange={onChange}
            onReady={setView}
            initialViewState={initialViewState}
            onViewState={queueViewState}
            fontSize={fontSize}
            settings={settings}
            onFontSize={(size, final) => changeFontSize(size, final)}
          />
          <EditorToolbar keys={DEFAULT_TOOLBAR} onRun={runKey} />
        </>
      ) : (
        <div className={styles.message}>
          <p className="title">{loaded.kind === 'binary' ? 'Binary file' : "Can't open file"}</p>
          <p className="caption muted">{loaded.kind === 'binary' ? 'Pepino only edits text files.' : loaded.message}</p>
        </div>
      )}

      {visible && inWorkspace && filesOpen && (
        <WorkspaceDrawer
          onClose={() => setFilesOpen(false)}
          onBack={() => tabs.onLeave(() => setFilesOpenNow(false))}
          onOpenFile={openOther}
        />
      )}

      {visible && versionsOpen && loaded?.kind === 'text' && (
        <VersionsView
          path={path}
          current={currentText}
          onRestore={(text) => void restoreVersion(text)}
          onClose={() => setVersionsOpen(false)}
        />
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

interface TabBarProps {
  tabs: EditorTabs;
  active: string;
  dirty: boolean;
  onTree: () => void;
  onCloseActive: () => void;
  onVersions: () => void;
}

/** At the end of the tab row: the file's earlier versions. */
function VersionsButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="text" square className={styles.versionsButton} aria-label="Earlier versions" onClick={onClick}>
      <HistoryIcon size={20} />
    </Button>
  );
}

/** The row under the top bar: the tree button, then one tab per open file (like VS Code). */
function TabBar({ tabs, active, dirty, onTree, onCloseActive, onVersions }: TabBarProps) {
  const activeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [active]);

  return (
    <div className={styles.tabBar}>
      <Button variant="text" square className={styles.treeButton} aria-label="Project files" onClick={onTree}>
        <TreeIcon size={20} />
      </Button>
      <div className={styles.tabs} role="tablist" aria-label="Open files">
        {tabs.files.map((file) => {
          const isActive = file === active;
          const name = basename(file);
          return (
            <div
              key={file}
              ref={isActive ? activeRef : undefined}
              className={cx(styles.tab, isActive && styles.tabActive)}
            >
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                className={cx('caption', styles.tabName)}
                onClick={() => !isActive && tabs.onSelect(file)}
              >
                <span className="ellipsis">{name}</span>
                {isActive && dirty && <span className={styles.tabDirty} aria-hidden />}
              </button>
              <button
                type="button"
                className={styles.tabClose}
                aria-label={`Close ${name}`}
                onClick={() => (isActive ? onCloseActive() : tabs.onClose(file))}
              >
                <CloseIcon size={14} />
              </button>
            </div>
          );
        })}
      </div>
      <VersionsButton onClick={onVersions} />
    </div>
  );
}
