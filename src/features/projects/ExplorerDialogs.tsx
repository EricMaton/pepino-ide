import { useState } from 'react';
import { useBackHandler } from '../../ui/back';
import { Button, Dialog, TextField } from '../../ui/components';
import { cx } from '../../ui/cx';
import { BackIcon, FolderIcon } from '../../ui/icons';
import { Breadcrumb } from './Breadcrumb';
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

const nameError = (name: string) => (name !== '' && !isValidEntryName(name) ? 'Invalid name' : null);
const kindOf = (entry: FileEntry) => (entry.isDirectory ? 'DIR' : 'FILE');

function CancelButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="text" onClick={onClick}>
      Cancel
    </Button>
  );
}

export function CreateEntryDialog({
  where,
  onClose,
  onCreate,
}: {
  /** Display path of the folder the entry goes into, e.g. "~/src". */
  where: string;
  onClose: () => void;
  onCreate: (asDirectory: boolean, name: string) => void;
}) {
  const [name, setName] = useState('');
  const valid = isValidEntryName(name);
  const create = (asDirectory: boolean) => valid && onCreate(asDirectory, name.trim());

  return (
    <Dialog
      title="New"
      eyebrow={`IN ${where}`}
      onClose={onClose}
      actions={
        <>
          <Button disabled={!valid} onClick={() => create(true)}>
            <FolderIcon size={18} />
            Folder
          </Button>
          <Button variant="filled" disabled={!valid} onClick={() => create(false)}>
            File
          </Button>
        </>
      }
    >
      <TextField
        label="Name"
        placeholder="main.ts"
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
      title="Rename"
      eyebrow={`${kindOf(entry)} · ${entry.name}`}
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
      <TextField label="New name" value={name} onChange={setName} error={nameError(name)} autoFocus onSubmit={rename} />
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
      title="Delete?"
      eyebrow={`${kindOf(entry)} · ${entry.name}`}
      onClose={onClose}
      actions={
        <>
          <CancelButton onClick={onClose} />
          <Button variant="filled" onClick={onConfirm}>
            Delete
          </Button>
        </>
      }
    >
      <p className={cx('body', styles.deleteText)}>
        {entry.isDirectory ? (
          <>
            <strong>{entry.name}/</strong> is a folder. Everything inside it will be deleted.
          </>
        ) : (
          <>
            <strong>{entry.name}</strong> will be deleted.
          </>
        )}
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
  const actions: Array<{ label: string; next: ExplorerDialog; danger?: boolean }> = [
    { label: 'Rename', next: { kind: 'rename', entry } },
    { label: 'Move to…', next: { kind: 'transfer', entry, move: true } },
    { label: 'Copy to…', next: { kind: 'transfer', entry, move: false } },
    { label: 'Delete', next: { kind: 'delete', entry }, danger: true },
  ];

  return (
    <Dialog title={entry.name} eyebrow={kindOf(entry)} onClose={onClose}>
      <div className={styles.actionList}>
        {actions.map(({ label, next, danger }) => (
          <Button
            key={label}
            variant="text"
            tone={danger ? 'danger' : 'default'}
            listItem
            onClick={() => onAction(next)}
          >
            <span className="accent" aria-hidden>
              ›
            </span>
            {label}
          </Button>
        ))}
      </div>
    </Dialog>
  );
}

/** Folder picker with its own path stack; back climbs it before closing the dialog. */
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
  const verb = move ? 'Move' : 'Copy';

  return (
    <Dialog
      title={`${verb} to…`}
      eyebrow={`${kindOf(entry)} · ${entry.name}`}
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
        <Button square disabled={!canGoUp} onClick={goUp} aria-label="Up one folder">
          <BackIcon size={20} />
        </Button>
        <Breadcrumb stack={pickStack} onJump={(depth) => setPickStack((stack) => stack.slice(0, depth + 1))} />
      </div>
      {listing === null ? (
        <p className={cx('label', 'cursor', styles.pickerMessage)}>Reading</p>
      ) : !listing.ok ? (
        <p className={cx('label', 'accent', styles.pickerMessage)}>✕ Can&apos;t read folder</p>
      ) : folders.length === 0 ? (
        <p className={cx('label', 'muted', styles.pickerMessage)}>No subfolders</p>
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
              <FolderIcon size={20} />
              <span className="ellipsis">{folder.name}</span>
            </Button>
          ))}
        </div>
      )}
    </Dialog>
  );
}
