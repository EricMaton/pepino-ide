import { type ReactNode, useState } from 'react';
import { useBackHandler } from '../../ui/back';
import { Button, Dialog, TextField } from '../../ui/components';
import { cx } from '../../ui/cx';
import { BackIcon, FolderIcon } from '../../ui/icons';
import { Breadcrumb } from './Breadcrumb';
import styles from './FileExplorer.module.css';
import { type FileEntry, isValidEntryName, sortEntries } from './files';
import { isReservedName } from './projects';
import type { ProjectSpace } from './projectSpace';
import { useDirectoryListing } from './useDirectoryListing';

/** [project] marks folders that are workspaces, which changes the wording. */
export type ExplorerDialog =
  | { kind: 'create' }
  | { kind: 'actions'; entry: FileEntry; project: boolean }
  | { kind: 'rename'; entry: FileEntry; project: boolean }
  | { kind: 'delete'; entry: FileEntry; project: boolean }
  | { kind: 'transfer'; entry: FileEntry; project: boolean; move: boolean };

export type CreateKind = 'folder' | 'file';

function nameError(name: string): string | null {
  if (name === '') return null;
  if (isReservedName(name)) return 'Reserved name';
  return isValidEntryName(name) ? null : 'Invalid name';
}

const isUsableName = (name: string) => name.trim() !== '' && nameError(name) === null;
const kindOf = (entry: FileEntry, project: boolean) => (project ? 'PROJECT' : entry.isDirectory ? 'DIR' : 'FILE');

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
  /** Display path of the folder the entry goes into, e.g. "~/projects/src". */
  where: string;
  onClose: () => void;
  onCreate: (kind: CreateKind, name: string) => void;
}) {
  const [name, setName] = useState('');
  const valid = isUsableName(name);
  const create = (kind: CreateKind) => valid && onCreate(kind, name.trim());

  return (
    <Dialog
      title="New"
      eyebrow={`IN ${where}`}
      onClose={onClose}
      actions={
        <>
          <Button disabled={!valid} onClick={() => create('folder')}>
            <FolderIcon size={18} />
            Folder
          </Button>
          <Button variant="filled" disabled={!valid} onClick={() => create('file')}>
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
        onSubmit={() => create('file')}
      />
    </Dialog>
  );
}

export function RenameEntryDialog({
  entry,
  project,
  onClose,
  onRename,
}: {
  entry: FileEntry;
  project: boolean;
  onClose: () => void;
  onRename: (newName: string) => void;
}) {
  const [name, setName] = useState(entry.name);
  const valid = isUsableName(name);
  const rename = () => valid && onRename(name.trim());

  return (
    <Dialog
      title="Rename"
      eyebrow={`${kindOf(entry, project)} · ${entry.name}`}
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
  project,
  onClose,
  onConfirm,
}: {
  entry: FileEntry;
  project: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      title="Delete?"
      eyebrow={`${kindOf(entry, project)} · ${entry.name}`}
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
            <strong>{entry.name}/</strong> is a {project ? 'project' : 'folder'}. Everything inside it will be deleted.
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
  project,
  onClose,
  onAction,
  extraActions = [],
}: {
  entry: FileEntry;
  project: boolean;
  onClose: () => void;
  onAction: (next: ExplorerDialog) => void;
  /** Listed first, e.g. "Open folder" in the explorer or "New file or folder here" in the workspace tree. */
  extraActions?: Array<{ label: string; run: () => void }>;
}) {
  const actions: Array<{ label: string; run: () => void; danger?: boolean }> = [
    ...extraActions,
    { label: 'Rename', run: () => onAction({ kind: 'rename', entry, project }) },
    { label: 'Move to…', run: () => onAction({ kind: 'transfer', entry, project, move: true }) },
    { label: 'Copy to…', run: () => onAction({ kind: 'transfer', entry, project, move: false }) },
    { label: 'Delete', run: () => onAction({ kind: 'delete', entry, project }), danger: true },
  ];

  return (
    <Dialog title={entry.name} eyebrow={kindOf(entry, project)} onClose={onClose}>
      <div className={styles.actionList}>
        {actions.map(({ label, run, danger }) => (
          <Button key={label} variant="text" tone={danger ? 'danger' : 'default'} listItem onClick={run}>
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

/** Folder picker with its own path stack, anchored at [rootPath]; back climbs it before closing the dialog. */
export function TransferDialog({
  entry,
  project,
  move,
  projectSpace,
  rootPath,
  rootLabel,
  onClose,
  onConfirm,
}: {
  entry: FileEntry;
  project: boolean;
  move: boolean;
  projectSpace: ProjectSpace;
  rootPath: string;
  rootLabel: ReactNode;
  onClose: () => void;
  onConfirm: (destinationDir: string) => void;
}) {
  const [pickStack, setPickStack] = useState<string[]>([rootPath]);
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
      eyebrow={`${kindOf(entry, project)} · ${entry.name}`}
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
        <Breadcrumb
          stack={pickStack}
          rootLabel={rootLabel}
          onJump={(depth) => setPickStack((stack) => stack.slice(0, depth + 1))}
        />
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
