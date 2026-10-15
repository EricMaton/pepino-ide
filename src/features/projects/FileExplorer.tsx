import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef, useState } from 'react';
import { useBackHandler } from '../../ui/back';
import { Button } from '../../ui/components';
import { cx } from '../../ui/cx';
import { BackIcon, FolderIcon, MoreIcon, PlusIcon, SortIcon } from '../../ui/icons';
import { SliceOutline } from '../../ui/Logo';
import { Breadcrumb } from './Breadcrumb';
import { errorMessage } from './errors';
import {
  CreateEntryDialog,
  DeleteEntryDialog,
  EntryActionsDialog,
  type ExplorerDialog,
  RenameEntryDialog,
  TransferDialog,
} from './ExplorerDialogs';
import styles from './FileExplorer.module.css';
import {
  type FileEntry,
  fileBadge,
  type FileSortOrder,
  formatModified,
  formatSize,
  nextSortOrder,
  SORT_LABELS,
  sortEntries,
} from './files';
import { basename, joinPath } from './paths';
import type { ProjectSpace } from './projectSpace';
import { useDirectoryListing } from './useDirectoryListing';

const ROW_HEIGHT = 68;
const FAB_CLEARANCE = 96;

/**
 * Touch file explorer anchored to the project space root. Navigation is a
 * stack of paths (ADR-003): opening a folder pushes, back pops, a breadcrumb
 * segment truncates the stack, and the root can never be left.
 */
export function FileExplorer({ projectSpace }: { projectSpace: ProjectSpace }) {
  const [pathStack, setPathStack] = useState<string[]>(['']);
  const currentPath = pathStack[pathStack.length - 1];
  const [sortOrder, setSortOrder] = useState<FileSortOrder>('name');
  const [refreshTick, setRefreshTick] = useState(0);
  const [dialog, setDialog] = useState<ExplorerDialog | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  const listing = useDirectoryListing(projectSpace, currentPath, refreshTick);

  const canGoUp = pathStack.length > 1;
  const goUp = () => setPathStack((stack) => (stack.length > 1 ? stack.slice(0, -1) : stack));
  useBackHandler(canGoUp, goUp);

  const runOperation = (operation: () => Promise<void>) => {
    setDialog(null);
    operation().then(
      () => {
        setOpError(null);
        setRefreshTick((tick) => tick + 1);
      },
      (error: unknown) => setOpError(errorMessage(error)),
    );
  };

  const where = ['~/projects', ...pathStack.slice(1).map(basename)].join('/');

  return (
    <div className={styles.explorer}>
      <div className={styles.toolbar}>
        <div className={styles.pathRow}>
          <Button square disabled={!canGoUp} onClick={goUp} aria-label="Up one folder">
            <BackIcon size={20} />
          </Button>
          <Breadcrumb stack={pathStack} onJump={(depth) => setPathStack((stack) => stack.slice(0, depth + 1))} />
        </div>
        <div className={styles.actionRow}>
          <span className="caption muted">
            {listing?.ok ? `${listing.entries.length} ${listing.entries.length === 1 ? 'ITEM' : 'ITEMS'}` : '— ITEMS'}
          </span>
          <Button onClick={() => setSortOrder(nextSortOrder)} aria-label={`Sort: ${SORT_LABELS[sortOrder]}`}>
            <SortIcon size={18} />
            {SORT_LABELS[sortOrder]}
          </Button>
          <Button variant="filled" onClick={() => setDialog({ kind: 'create' })}>
            <PlusIcon size={18} />
            New
          </Button>
        </div>
      </div>
      {opError && (
        <p className={cx('label', styles.opError)} role="alert">
          ✕ {opError}
        </p>
      )}
      {listing === null ? (
        <p className={cx('label', 'cursor', styles.loading)}>Reading</p>
      ) : !listing.ok ? (
        <div className={styles.state}>
          <p className={cx('label', styles.readError)}>
            ✕ Can&apos;t read folder
            <span className="caption">{listing.message}</span>
          </p>
        </div>
      ) : listing.entries.length === 0 ? (
        <EmptyFolder />
      ) : (
        <EntryList
          key={currentPath}
          entries={sortEntries(listing.entries, sortOrder)}
          onOpen={(entry) => setPathStack((stack) => [...stack, entry.path])}
          onActions={(entry) => setDialog({ kind: 'actions', entry })}
        />
      )}

      {dialog?.kind === 'create' && (
        <CreateEntryDialog
          where={where}
          onClose={() => setDialog(null)}
          onCreate={(asDirectory, name) =>
            runOperation(() => {
              const path = joinPath(currentPath, name);
              return asDirectory ? projectSpace.createDirectory(path) : projectSpace.createFile(path);
            })
          }
        />
      )}
      {dialog?.kind === 'actions' && (
        <EntryActionsDialog entry={dialog.entry} onClose={() => setDialog(null)} onAction={setDialog} />
      )}
      {dialog?.kind === 'rename' && (
        <RenameEntryDialog
          entry={dialog.entry}
          onClose={() => setDialog(null)}
          onRename={(newName) => runOperation(() => projectSpace.rename(dialog.entry.path, newName))}
        />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteEntryDialog
          entry={dialog.entry}
          onClose={() => setDialog(null)}
          onConfirm={() => runOperation(() => projectSpace.delete(dialog.entry.path))}
        />
      )}
      {dialog?.kind === 'transfer' && (
        <TransferDialog
          entry={dialog.entry}
          move={dialog.move}
          projectSpace={projectSpace}
          onClose={() => setDialog(null)}
          onConfirm={(destination) =>
            runOperation(() =>
              dialog.move
                ? projectSpace.move(dialog.entry.path, destination)
                : projectSpace.copy(dialog.entry.path, destination),
            )
          }
        />
      )}
    </div>
  );
}

interface EntryListProps {
  entries: FileEntry[];
  onOpen: (entry: FileEntry) => void;
  onActions: (entry: FileEntry) => void;
}

function EntryList({ entries, onOpen, onActions }: EntryListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/incompatible-library -- the virtualizer is read during render by design
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => entries[index].path,
    paddingEnd: FAB_CLEARANCE,
    overscan: 8,
  });

  return (
    <div ref={scrollRef} className={styles.scroller}>
      <div className={styles.rows} style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => (
          <FileRow
            key={item.key}
            index={item.index}
            entry={entries[item.index]}
            top={item.start}
            onOpen={onOpen}
            onActions={onActions}
          />
        ))}
      </div>
    </div>
  );
}

interface FileRowProps {
  index: number;
  entry: FileEntry;
  top: number;
  onOpen: (entry: FileEntry) => void;
  onActions: (entry: FileEntry) => void;
}

function FileRow({ index, entry, top, onOpen, onActions }: FileRowProps) {
  const meta = [entry.isDirectory ? 'DIR' : formatSize(entry.sizeBytes), formatModified(entry.modifiedMillis)];
  const content = (
    <>
      <span className={cx('caption', 'muted', styles.index)} aria-hidden>
        {String(index + 1).padStart(2, '0')}
      </span>
      {entry.isDirectory ? (
        <span className={cx(styles.badge, styles.badgeDir)} aria-hidden>
          <FolderIcon size={20} />
        </span>
      ) : (
        <span className={cx('caption', styles.badge, styles.badgeFile)} aria-hidden>
          {fileBadge(entry.name)}
        </span>
      )}
      <span className={styles.rowText}>
        <span className="body ellipsis">
          {entry.name}
          {entry.isDirectory && <span className="muted">/</span>}
        </span>
        <span className="caption muted ellipsis">{meta.join('  ·  ')}</span>
      </span>
    </>
  );

  return (
    <div className={styles.row} style={{ height: ROW_HEIGHT, transform: `translateY(${top}px)` }}>
      {entry.isDirectory ? (
        <button type="button" className={styles.rowMain} onClick={() => onOpen(entry)}>
          {content}
        </button>
      ) : (
        <div className={styles.rowMain}>{content}</div>
      )}
      <Button
        variant="text"
        square
        className="muted"
        aria-label={`Actions for ${entry.name}`}
        onClick={() => onActions(entry)}
      >
        <MoreIcon size={18} />
      </Button>
    </div>
  );
}

function EmptyFolder() {
  return (
    <div className={styles.state}>
      <SliceOutline size={112} />
      <p className="title">Empty folder</p>
      <p className="caption muted">
        Tap <span className="accent">+ NEW</span> to create a file or folder here.
      </p>
    </div>
  );
}
