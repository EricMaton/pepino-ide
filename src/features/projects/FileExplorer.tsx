import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef, useState } from 'react';
import { useBackHandler } from '../../ui/back';
import { Button, Divider } from '../../ui/components';
import { cx } from '../../ui/cx';
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
  type FileSortOrder,
  formatModified,
  formatSize,
  nextSortOrder,
  SORT_LABELS,
  sortEntries,
} from './files';
import { joinPath } from './paths';
import type { ProjectSpace } from './projectSpace';
import { useDirectoryListing } from './useDirectoryListing';

const ROW_HEIGHT = 65;
const FAB_CLEARANCE = 88;

/**
 * Touch file explorer anchored to the project space root. Navigation is a
 * stack of paths (ADR-003): opening a folder pushes, UP pops, and UP is
 * disabled at the root, so the UI can never leave the project space.
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

  return (
    <div className={styles.explorer}>
      <ExplorerToolbar
        canGoUp={canGoUp}
        segments={pathStack.slice(1).map((path) => path.slice(path.lastIndexOf('/') + 1))}
        sortOrder={sortOrder}
        onUp={goUp}
        onCycleSort={() => setSortOrder(nextSortOrder)}
        onCreate={() => setDialog({ kind: 'create' })}
      />
      <Divider />
      {opError && <p className={cx('label', styles.opError)}>ERROR: {opError.toUpperCase()}</p>}
      {listing === null ? (
        <ExplorerMessage text="LOADING…" />
      ) : !listing.ok ? (
        <ExplorerMessage text={`CAN'T READ FOLDER\n${listing.message}`} />
      ) : listing.entries.length === 0 ? (
        <ExplorerMessage text="EMPTY FOLDER" />
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

interface ToolbarProps {
  canGoUp: boolean;
  segments: string[];
  sortOrder: FileSortOrder;
  onUp: () => void;
  onCycleSort: () => void;
  onCreate: () => void;
}

function ExplorerToolbar({ canGoUp, segments, sortOrder, onUp, onCycleSort, onCreate }: ToolbarProps) {
  return (
    <div className={styles.toolbar}>
      <Button disabled={!canGoUp} onClick={onUp}>
        Up
      </Button>
      <div className={styles.location}>
        <span className="label muted">LOCATION</span>
        <span className={cx('body', 'mono', 'ellipsis', styles.breadcrumb)}>
          <bdi>{['ROOT', ...segments].join(' / ')}</bdi>
        </span>
      </div>
      <Button onClick={onCreate} aria-label="Create file or folder">
        +
      </Button>
      <Button onClick={onCycleSort}>SORT: {SORT_LABELS[sortOrder]}</Button>
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
          <FileRow key={item.key} entry={entries[item.index]} top={item.start} onOpen={onOpen} onActions={onActions} />
        ))}
      </div>
    </div>
  );
}

interface FileRowProps {
  entry: FileEntry;
  top: number;
  onOpen: (entry: FileEntry) => void;
  onActions: (entry: FileEntry) => void;
}

function FileRow({ entry, top, onOpen, onActions }: FileRowProps) {
  const meta = [entry.isDirectory ? 'FOLDER' : formatSize(entry.sizeBytes), formatModified(entry.modifiedMillis)];
  const content = (
    <>
      <span className={cx('title', styles.icon, entry.isDirectory ? 'accent' : 'muted')} aria-hidden>
        {entry.isDirectory ? '/' : '·'}
      </span>
      <span className={styles.rowText}>
        <span className="body ellipsis">{entry.name}</span>
        <span className="label muted ellipsis">{meta.join('  ·  ')}</span>
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
        className={cx('title', styles.more, 'muted')}
        aria-label={`Actions for ${entry.name}`}
        onClick={() => onActions(entry)}
      >
        ···
      </Button>
    </div>
  );
}

function ExplorerMessage({ text }: { text: string }) {
  return <p className={cx('label', 'muted', styles.message)}>{text}</p>;
}
