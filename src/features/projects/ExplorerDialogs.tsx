import { useState } from 'react';
import { useBackHandler } from '../../ui/back';
import { Button, Dialog, TextField } from '../../ui/components';
import { cx } from '../../ui/cx';
import styles from './FileExplorer.module.css';
import { type FileEntry, isValidEntryName, sortEntries } from './files';
import type { ProjectSpace } from './projectSpace';
import { useDirectoryListing } from './useDirectoryListing';

export type ExplorerDialog =
  | { kind: 'create' }
  | { kind: 'actions'; entry: FileEntry }
  | { kind: 'rename'; entry: FileEntry }
  | { kind: 'delete'; entry: FileEntry }
  | { kind: 'transfer'; entry: FileEntry; move: boolean };

const nameError = (name: string) => (name !== '' && !isValidEntryName(name) ? 'INVALID NAME' : null);

function CancelButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="text" onClick={onClick}>
      Cancel
    </Button>
  );
}

export function CreateEntryDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (asDirectory: boolean, name: string) => void;
}) {
  const [name, setName] = useState('');
  const valid = isValidEntryName(name);
  const create = (asDirectory: boolean) => valid && onCreate(asDirectory, name.trim());

  return (
    <Dialog
      title="CREATE"
      onClose={onClose}
      actions={
        <>
          <CancelButton onClick={onClose} />
          <Button variant="text" disabled={!valid} onClick={() => create(true)}>
            Folder
          </Button>
          <Button variant="filled" disabled={!valid} onClick={() => create(false)}>
            File
          </Button>
        </>
      }
    >
      <TextField
        label="NAME"
        value={name}
        onChange={setName}
        error={nameError(name)}
        autoFocus
        onSubmit={() => create(false)}
      />
    </Dialog>
  );
}

export function RenameEntryDialog({
  entry,
  onClose,
  onRename,
}: {
  entry: FileEntry;
  onClose: () => void;
  onRename: (newName: string) => void;
}) {
  const [name, setName] = useState(entry.name);
  const valid = isValidEntryName(name);
  const rename = () => valid && onRename(name.trim());

  return (
    <Dialog
      title="RENAME"
      onClose={onClose}
      actions={
        <>
          <CancelButton onClick={onClose} />
          <Button variant="filled" disabled={!valid} onClick={rename}>
            Rename
          </Button>
        </>
      }
    >
      <TextField label="NAME" value={name} onChange={setName} error={nameError(name)} autoFocus onSubmit={rename} />
    </Dialog>
  );
}

export function DeleteEntryDialog({
  entry,
  onClose,
  onConfirm,
}: {
  entry: FileEntry;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      title="DELETE?"
      onClose={onClose}
      actions={
        <>
          <CancelButton onClick={onClose} />
          <Button variant="text" tone="danger" onClick={onConfirm}>
            Delete
          </Button>
        </>
      }
    >
      <p className={cx('body', styles.deleteText)}>
        {entry.isDirectory ? `${entry.name} IS A FOLDER.\nEVERYTHING INSIDE IT WILL BE DELETED.` : entry.name}
      </p>
    </Dialog>
  );
}

export function EntryActionsDialog({
  entry,
  onClose,
  onAction,
}: {
  entry: FileEntry;
  onClose: () => void;
  onAction: (next: ExplorerDialog) => void;
}) {
  return (
    <Dialog title={entry.name} onClose={onClose} actions={<CancelButton onClick={onClose} />}>
      <div className={styles.actionList}>
        <Button variant="text" listItem onClick={() => onAction({ kind: 'rename', entry })}>
          Rename
        </Button>
        <Button variant="text" listItem onClick={() => onAction({ kind: 'transfer', entry, move: true })}>
          Move
        </Button>
        <Button variant="text" listItem onClick={() => onAction({ kind: 'transfer', entry, move: false })}>
          Copy
        </Button>
        <Button variant="text" tone="danger" listItem onClick={() => onAction({ kind: 'delete', entry })}>
          Delete
        </Button>
      </div>
    </Dialog>
  );
}

/** Folder picker with its own path stack; back/UP climb it before closing the dialog. */
export function TransferDialog({
  entry,
  move,
  projectSpace,
  onClose,
  onConfirm,
}: {
  entry: FileEntry;
  move: boolean;
  projectSpace: ProjectSpace;
  onClose: () => void;
  onConfirm: (destinationDir: string) => void;
}) {
  const [pickStack, setPickStack] = useState<string[]>(['']);
  const pickPath = pickStack[pickStack.length - 1];
  const listing = useDirectoryListing(projectSpace, pickPath);
  const canGoUp = pickStack.length > 1;
  const goUp = () => setPickStack((stack) => (stack.length > 1 ? stack.slice(0, -1) : stack));
  useBackHandler(canGoUp, goUp);

  const folders = listing?.ok
    ? sortEntries(
        listing.entries.filter((folder) => folder.isDirectory && folder.path !== entry.path),
        'name',
      )
    : [];
  const segments = pickStack.slice(1).map((path) => path.slice(path.lastIndexOf('/') + 1));
  const verb = move ? 'MOVE' : 'COPY';

  return (
    <Dialog
      title={`${verb} — ${entry.name}`}
      onClose={onClose}
      actions={
        <>
          <CancelButton onClick={onClose} />
          <Button variant="filled" onClick={() => onConfirm(pickPath)}>
            {verb} here
          </Button>
        </>
      }
    >
      <div className={styles.pickerBar}>
        <Button disabled={!canGoUp} onClick={goUp}>
          Up
        </Button>
        <span className={cx('body', 'mono', 'ellipsis', styles.breadcrumb)}>
          <bdi>{['ROOT', ...segments].join(' / ')}</bdi>
        </span>
      </div>
      {listing === null ? (
        <p className={cx('label', 'muted', styles.pickerMessage)}>LOADING…</p>
      ) : !listing.ok ? (
        <p className={cx('label', 'accent', styles.pickerMessage)}>CAN&apos;T READ FOLDER</p>
      ) : folders.length === 0 ? (
        <p className={cx('label', 'muted', styles.pickerMessage)}>NO SUBFOLDERS</p>
      ) : (
        <div className={styles.pickerList}>
          {folders.map((folder) => (
            <Button
              key={folder.path}
              variant="text"
              listItem
              className={cx('body', styles.pickerFolder)}
              onClick={() => setPickStack((stack) => [...stack, folder.path])}
            >
              <span className="title accent" aria-hidden>
                /
              </span>
              <span className="ellipsis">{folder.name}</span>
            </Button>
          ))}
        </div>
      )}
    </Dialog>
  );
}
