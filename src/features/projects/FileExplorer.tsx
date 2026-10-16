import { useVirtualizer } from '@tanstack/react-virtual';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useBackHandler } from '../../ui/back';
import { Button } from '../../ui/components';
import { cx } from '../../ui/cx';
import { navigate } from '../../ui/motion';
import { BackIcon, FolderIcon, MoreIcon, OpenIcon, PlusIcon, ProjectIcon, SortIcon } from '../../ui/icons';
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
import { GIT_DIR } from './projects';
import type { ProjectSpace } from './projectSpace';
import { useDirectoryListing } from './useDirectoryListing';
import { useFolderChanges } from './useFolderChanges';

const ROW_HEIGHT = 68;
const LIST_END_PADDING = 16;

interface FileExplorerProps {
  projectSpace: ProjectSpace;
  /** Folder the explorer is anchored to ('' for the whole space). */
  rootPath: string;
  /** Breadcrumb label for [rootPath]. */
  rootLabel: ReactNode;
  /** Plain-text form of [rootLabel], e.g. "~/projects". */
  rootName: string;
  /** Opens a file in the editor; without it file rows are not tappable. */
  onOpenFile?: (path: string) => void;
  /**
   * Opens a folder as the workspace: each folder row's open button, its ⋯ menu and "Open" for the
   * folder showing (not at the space root, which is never a workspace).
   */
  onOpenFolder?: (path: string) => void;
  /** The active project, marked in the list. */
  activePath?: string | null;
  /** Folders that have been workspaces (the recent projects), marked in the list. */
  workspaces?: ReadonlySet<string>;
  /** Shown above the listing while the explorer is at its root (e.g. recent projects). */
  rootHeader?: ReactNode;
  /** Path stack to start from (restored session); must start at [rootPath]. */
  initialStack?: string[];
  /** Called whenever the path stack changes, to remember where the user was. */
  onStackChange?: (stack: string[]) => void;
}

/**
 * Touch file explorer anchored to [rootPath]. Navigation is a stack of paths
 * (ADR-003): opening a folder pushes, back pops, a breadcrumb segment
 * truncates the stack, and nothing above the root is ever reachable.
 */
export function FileExplorer({
  projectSpace,
  rootPath,
  rootLabel,
  rootName,
  onOpenFile,
  onOpenFolder,
  activePath = null,
  workspaces = NO_WORKSPACES,
  rootHeader,
  initialStack,
  onStackChange,
}: FileExplorerProps) {
  const [pathStack, setPathStack] = useState<string[]>(() =>
    initialStack?.[0] === rootPath ? initialStack : [rootPath],
  );
  const currentPath = pathStack[pathStack.length - 1];
  const reportStack = useRef(onStackChange);
  useEffect(() => {
    reportStack.current = onStackChange;
  });
  useEffect(() => {
    reportStack.current?.(pathStack);
  }, [pathStack]);
  const [sortOrder, setSortOrder] = useState<FileSortOrder>('name');
  const [refreshTick, setRefreshTick] = useState(0);
  const [dialog, setDialog] = useState<ExplorerDialog | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  // Repositories are marked near the top of the space, where projects usually live.
  const listing = useDirectoryListing(projectSpace, currentPath, refreshTick, pathStack.length <= 2);
  // Changes made elsewhere (editor, workspace tree, plugins) show up without leaving the folder.
  useFolderChanges(currentPath, () => setRefreshTick((tick) => tick + 1));

  const canGoUp = pathStack.length > 1;
  // Going in slides the new folder in from the right; going up brings the parent back from the left.
  const goInto = (folder: string) => navigate('forward', () => setPathStack((stack) => [...stack, folder]));
  const goToDepth = (depth: number) => navigate('back', () => setPathStack((stack) => stack.slice(0, depth + 1)));
  const goUp = () => goToDepth(pathStack.length - 2);
  useBackHandler(canGoUp, goUp);

  const atSpaceRoot = currentPath === '';
  const repos = listing?.ok ? listing.repos : NO_WORKSPACES;
  const marksOf = (entry: FileEntry): FolderMarks => ({
    active: entry.path === activePath,
    workspace: entry.path === activePath || workspaces.has(entry.path),
    repo: repos.has(entry.path),
  });
  const isWorkspace = (entry: FileEntry) => entry.isDirectory && marksOf(entry).workspace;

  const runOperation = (operation: () => Promise<unknown>) => {
    setDialog(null);
    operation().then(
      () => {
        setOpError(null);
        setRefreshTick((tick) => tick + 1);
      },
      (error: unknown) => setOpError(errorMessage(error)),
    );
  };

  const where = [rootName, ...pathStack.slice(1).map(basename)].join('/');

  return (
    <div className={styles.explorer}>
      {/* Up = the ← (or the system back) or a breadcrumb segment; nothing above the root. */}
      <div className={styles.toolbar}>
        {canGoUp && (
          <Button variant="text" square onClick={goUp} aria-label="Up one folder">
            <BackIcon size={22} />
          </Button>
        )}
        <Breadcrumb stack={pathStack} rootLabel={rootLabel} onJump={goToDepth} />
        <Button
          square
          onClick={() => setSortOrder(nextSortOrder)}
          aria-label={`Sort: ${SORT_LABELS[sortOrder]}`}
          title={`Sort: ${SORT_LABELS[sortOrder]}`}
        >
          <SortIcon size={18} />
        </Button>
        {onOpenFolder && !atSpaceRoot && (
          <Button variant="filled" onClick={() => onOpenFolder(currentPath)} aria-label="Open folder">
            <OpenIcon size={18} />
            Open
          </Button>
        )}
        <Button square onClick={() => setDialog({ kind: 'create' })} aria-label="New file or folder">
          <PlusIcon size={22} />
        </Button>
      </div>
      {currentPath === rootPath && rootHeader}
      {opError && (
        <p className={cx('label', styles.opError)} role="alert">
          ✕ {opError}
        </p>
      )}
      {listing === null ? (
        <p className={cx('label', 'cursor', styles.loading)} data-loading>
          Reading
        </p>
      ) : !listing.ok ? (
        <div className={styles.state}>
          <p className={cx('label', styles.readError)}>
            ✕ Can&apos;t read folder
            <span className="caption">{listing.message}</span>
          </p>
        </div>
      ) : listing.entries.length === 0 ? (
        atSpaceRoot && onOpenFolder ? (
          <EmptyFolder title="No projects yet" brand>
            Tap <span className="accent">+</span> to create a folder, then open it to work in it.
          </EmptyFolder>
        ) : (
          <EmptyFolder />
        )
      ) : (
        <EntryList
          key={currentPath}
          entries={sortEntries(listing.entries, sortOrder)}
          filesOpenable={onOpenFile !== undefined}
          marksOf={marksOf}
          onOpen={(entry) => {
            if (!entry.isDirectory) onOpenFile?.(entry.path);
            else goInto(entry.path);
          }}
          onOpenFolder={onOpenFolder}
          onActions={(entry) => setDialog({ kind: 'actions', entry, project: isWorkspace(entry) })}
        />
      )}

      {dialog?.kind === 'create' && (
        <CreateEntryDialog
          where={where}
          onClose={() => setDialog(null)}
          onCreate={(kind, name) =>
            runOperation(() => {
              const path = joinPath(currentPath, name);
              return kind === 'folder' ? projectSpace.createDirectory(path) : projectSpace.createFile(path);
            })
          }
        />
      )}
      {dialog?.kind === 'actions' && (
        <EntryActionsDialog
          entry={dialog.entry}
          project={dialog.project}
          extraActions={
            dialog.entry.isDirectory && dialog.entry.name !== GIT_DIR && onOpenFolder
              ? [
                  {
                    label: 'Open folder',
                    run: () => {
                      setDialog(null);
                      onOpenFolder(dialog.entry.path);
                    },
                  },
                ]
              : []
          }
          onClose={() => setDialog(null)}
          onAction={setDialog}
        />
      )}
      {dialog?.kind === 'rename' && (
        <RenameEntryDialog
          entry={dialog.entry}
          project={dialog.project}
          onClose={() => setDialog(null)}
          onRename={(newName) => runOperation(() => projectSpace.rename(dialog.entry.path, newName))}
        />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteEntryDialog
          entry={dialog.entry}
          project={dialog.project}
          onClose={() => setDialog(null)}
          onConfirm={() => runOperation(() => projectSpace.delete(dialog.entry.path))}
        />
      )}
      {dialog?.kind === 'transfer' && (
        <TransferDialog
          entry={dialog.entry}
          project={dialog.project}
          move={dialog.move}
          projectSpace={projectSpace}
          rootPath={rootPath}
          rootLabel={rootLabel}
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

const NO_WORKSPACES: ReadonlySet<string> = new Set();

interface FolderMarks {
  active: boolean;
  workspace: boolean;
  repo: boolean;
}

interface EntryListProps {
  entries: FileEntry[];
  filesOpenable: boolean;
  marksOf: (entry: FileEntry) => FolderMarks;
  onOpen: (entry: FileEntry) => void;
  onOpenFolder?: (path: string) => void;
  onActions: (entry: FileEntry) => void;
}

function EntryList({ entries, filesOpenable, marksOf, onOpen, onOpenFolder, onActions }: EntryListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/incompatible-library -- the virtualizer is read during render by design
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => entries[index].path,
    paddingEnd: LIST_END_PADDING,
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
            openable={filesOpenable || entries[item.index].isDirectory}
            marks={entries[item.index].isDirectory ? marksOf(entries[item.index]) : NO_MARKS}
            top={item.start}
            onOpen={onOpen}
            onOpenFolder={onOpenFolder}
            onActions={onActions}
          />
        ))}
      </div>
    </div>
  );
}

const NO_MARKS: FolderMarks = { active: false, workspace: false, repo: false };

/** "ACTIVE · GIT", "WORKSPACE", "DIR"… what a folder is, as shown under its name. */
function folderKind({ active, workspace, repo }: FolderMarks): ReactNode {
  const tags = [active ? 'ACTIVE' : workspace && 'WORKSPACE', repo && 'GIT'].filter(Boolean).join(' · ');
  return tags ? <span className={cx(active && 'accent')}>{tags}</span> : 'DIR';
}

interface FileRowProps {
  index: number;
  entry: FileEntry;
  openable: boolean;
  marks: FolderMarks;
  top: number;
  onOpen: (entry: FileEntry) => void;
  onOpenFolder?: (path: string) => void;
  onActions: (entry: FileEntry) => void;
}

function FileRow({ index, entry, openable, marks, top, onOpen, onOpenFolder, onActions }: FileRowProps) {
  const kind = entry.isDirectory ? folderKind(marks) : formatSize(entry.sizeBytes);
  const content = (
    <>
      <span className={cx('caption', 'muted', styles.index)} aria-hidden>
        {String(index + 1).padStart(2, '0')}
      </span>
      {entry.isDirectory && marks.workspace ? (
        <span className={cx(styles.badge, styles.badgeDir)} aria-hidden>
          <ProjectIcon size={22} />
        </span>
      ) : entry.isDirectory ? (
        <span className={cx(styles.badge, styles.badgeDir)} aria-hidden>
          <FolderIcon size={20} />
        </span>
      ) : (
        <span className={cx('caption', styles.badge, styles.badgeFile)} aria-hidden>
          {fileBadge(entry.name)}
        </span>
      )}
      <span className={styles.rowText}>
        <span className={cx('body', 'ellipsis', marks.workspace && styles.projectName)}>
          {entry.name}
          {entry.isDirectory && <span className="muted">/</span>}
        </span>
        <span className="caption muted ellipsis">
          {kind}
          {'  ·  '}
          {formatModified(entry.modifiedMillis)}
        </span>
      </span>
    </>
  );

  return (
    <div
      className={cx(styles.row, marks.active && styles.rowActive)}
      style={{ height: ROW_HEIGHT, transform: `translateY(${top}px)` }}
    >
      {openable ? (
        <button
          type="button"
          className={styles.rowMain}
          aria-current={marks.active ? 'true' : undefined}
          onClick={() => onOpen(entry)}
        >
          {content}
        </button>
      ) : (
        <div className={styles.rowMain}>{content}</div>
      )}
      {entry.isDirectory && entry.name !== GIT_DIR && onOpenFolder && (
        <Button
          variant="text"
          square
          aria-label={`Open ${entry.name} as workspace`}
          onClick={() => onOpenFolder(entry.path)}
        >
          <OpenIcon size={20} />
        </Button>
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

/** An empty folder; [brand] shows the Pepino slice, kept for the first run (no projects yet). */
export function EmptyFolder({
  title = 'Empty folder',
  brand = false,
  children,
}: {
  title?: string;
  brand?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={styles.state}>
      {brand ? (
        <SliceOutline size={112} />
      ) : (
        <span className={styles.emptyIcon} aria-hidden>
          <FolderIcon size={56} />
        </span>
      )}
      <p className="title">{title}</p>
      <p className="caption muted">
        {children ?? (
          <>
            Tap <span className="accent">+</span> to create a file or folder here.
          </>
        )}
      </p>
    </div>
  );
}
