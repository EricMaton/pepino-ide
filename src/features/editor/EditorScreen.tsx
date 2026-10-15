import { Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useServices } from '../../app/services';
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
import { DEFAULT_TOOLBAR } from './toolbar';

type Loaded = { kind: 'text'; text: string } | { kind: 'binary' } | { kind: 'error'; message: string };

interface EditorScreenProps {
  path: string;
  /** False while another tab is showing: the editor stays mounted (keeping edits) but hidden. */
  visible: boolean;
  /** Breadcrumb-style folder label shown under the file name. */
  folderLabel: string;
  onClose: () => void;
}

/** Full-height editor for one file, laid over the explorer so closing it returns to the same folder. */
export default function EditorScreen({ path, visible, folderLabel, onClose }: EditorScreenProps) {
  const { projectSpace, registry, dispatcher, events } = useServices();
  const showSnackbar = useSnackbar();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [view, setView] = useState<EditorView | null>(null);
  const doc = useRef<Text | null>(null);
  const savedDoc = useRef<Text | null>(null);
  const name = basename(path);

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
        savedDoc.current = Text.of(text.split(/\r\n?|\n/));
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

  const save = useCallback(async () => {
    const current = doc.current;
    if (!current || (savedDoc.current && current.eq(savedDoc.current))) return true;
    try {
      await projectSpace.writeTextFile(path, current.toString());
      savedDoc.current = current;
      setDirty(doc.current !== null && !doc.current.eq(current));
      events.publish('file.saved', { path });
      return true;
    } catch (error) {
      showSnackbar(`Error: ${errorMessage(error)}`);
      return false;
    }
  }, [projectSpace, events, path, showSnackbar]);

  const requestClose = useCallback(() => {
    if (dirty) setConfirmClose(true);
    else onClose();
  }, [dirty, onClose]);

  useBackHandler(visible && !confirmClose, requestClose);

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
      registry.register({ id: 'editor.close', title: `Close ${name}`, run: requestClose }),
    ];
    return () => disposers.forEach((dispose) => dispose());
  }, [registry, visible, name, save, requestClose]);

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
    setDirty(savedDoc.current === null || !next.eq(savedDoc.current));
  };

  const language = languageFor(name);

  return (
    <section className={styles.screen} hidden={!visible} aria-label={`Editor: ${name}`}>
      <header className={styles.bar}>
        <Button square onClick={requestClose} aria-label="Close file">
          <BackIcon size={20} />
        </Button>
        <div className={styles.file}>
          <span className="caption muted ellipsis">
            {folderLabel} · {language?.label.toUpperCase() ?? fileBadge(name)}
          </span>
          <h2 className="title">
            <span className="ellipsis">{name}</span>
            {dirty && <span className={styles.dirty} role="img" aria-label="Unsaved changes" />}
          </h2>
        </div>
        <Button variant="filled" disabled={!dirty} onClick={() => void save()}>
          Save
        </Button>
      </header>

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
          title="Unsaved changes"
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
                Save & close
              </Button>
            </>
          }
        >
          <p className="body">
            <strong>{name}</strong> has changes that are not saved yet.
          </p>
        </Dialog>
      )}
    </section>
  );
}
