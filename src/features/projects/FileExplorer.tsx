import { useVirtualizer } from '@tanstack/react-virtual';
import { type ReactNode, useRef, useState } from 'react';
import { useBackHandler } from '../../ui/back';
import { Button } from '../../ui/components';
import { cx } from '../../ui/cx';
import { BackIcon, FolderIcon, MoreIcon, PlusIcon, SortIcon } from '../../ui/icons';
import { PepinoMark, SliceOutline } from '../../ui/Logo';
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
import { canBeProject, createProject, markAsProject } from './projects';
import type { ProjectSpace } from './projectSpace';
import { useDirectoryListing } from './useDirectoryListing';

const ROW_HEIGHT = 68;
const FAB_CLEARANCE = 96;

interface FileExplorerProps {
  projectSpace: ProjectSpace;
  /** Folder the explorer is anchored to: '' for the whole space, or a project. */
  rootPath: string;
  /** Breadcrumb label for [rootPath]. */
  rootLabel: ReactNode;
  /** Plain-text form of [rootLabel], e.g. "~/projects". */
  rootName: string;
  /** Called on back/UP at the root (closes the project); without it the root is a dead end. */
  onExitRoot?: () => void;
  /** Space mode: top-level projects open through here instead of being browsed into. */
  onOpenProject?: (path: string) => void;
  /** Opens a file in the editor; without it file rows are not tappable. */
  onOpenFile?: (path: string) => void;
  /** Shown above the listing while the explorer is at its root (e.g. recent projects). */
  rootHeader?: ReactNode;
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
  onExitRoot,
  onOpenProject,
  rootHeader,
  onOpenFile,
}: FileExplorerProps) {
  const [pathStack, setPathStack] = useState<string[]>([rootPath]);
  const currentPath = pathStack[pathStack.length - 1];
  const [sortOrder, setSortOrder] = useState<FileSortOrder>('name');
  const [refreshTick, setRefreshTick] = useState(0);
  const [dialog, setDialog] = useState<ExplorerDialog | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  const atSpaceRoot = onOpenProject !== undefined && currentPath === '';
  const listing = useDirectoryListing(projectSpace, currentPath, refreshTick, atSpaceRoot);
  const projects = listing?.ok ? listing.projects : new Set<string>();

  const canGoUp = pathStack.length > 1;
  const goUp = () => {
    if (pathStack.length > 1) setPathStack((stack) => stack.slice(0, -1));
    else onExitRoot?.();
  };
  useBackHandler(canGoUp || onExitRoot !== undefined, goUp);

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

  const openProject = (operation: () => Promise<{ path: string }>) =>
    runOperation(async () => {
      const project = await operation();
      onOpenProject?.(project.path);
    });

  const where = [rootName, ...pathStack.slice(1).map(basename)].join('/');

  return (
    <div className={styles.explorer}>
      <div className={styles.toolbar}>
        <div className={styles.pathRow}>
          <Button
            square
            disabled={!canGoUp && !onExitRoot}
            onClick={goUp}
            aria-label={canGoUp ? 'Up one folder' : 'Close project'}
          >
            <BackIcon size={20} />
          </Button>
          <Breadcrumb
            stack={pathStack}
            rootLabel={rootLabel}
            onJump={(depth) => setPathStack((stack) => stack.slice(0, depth + 1))}
          />
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
      {currentPath === rootPath && rootHeader}
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
        <EmptyFolder spaceRoot={atSpaceRoot} />
      ) : (
        <EntryList
          key={currentPath}
          entries={sortEntries(listing.entries, sortOrder)}
          projects={projects}
          filesOpenable={onOpenFile !== undefined}
          onOpen={(entry) => {
            if (!entry.isDirectory) onOpenFile?.(entry.path);
            else if (projects.has(entry.path) && onOpenProject) onOpenProject(entry.path);
            else setPathStack((stack) => [...stack, entry.path]);
          }}
          onActions={(entry) => setDialog({ kind: 'actions', entry, project: projects.has(entry.path) })}
        />
      )}

      {dialog?.kind === 'create' && (
        <CreateEntryDialog
          where={where}
          allowProject={atSpaceRoot}
          onClose={() => setDialog(null)}
          onCreate={(kind, name) =>
            kind === 'project'
              ? openProject(() => createProject(projectSpace, name))
              : runOperation(() => {
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
          canOpenAsProject={
            onOpenProject !== undefined &&
            !dialog.project &&
            dialog.entry.isDirectory &&
            canBeProject(dialog.entry.path)
          }
          onClose={() => setDialog(null)}
          onAction={setDialog}
          onOpenAsProject={() => openProject(() => markAsProject(projectSpace, dialog.entry.path))}
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

interface EntryListProps {
  entries: FileEntry[];
  projects: ReadonlySet<string>;
  filesOpenable: boolean;
  onOpen: (entry: FileEntry) => void;
  onActions: (entry: FileEntry) => void;
}

function EntryList({ entries, projects, filesOpenable, onOpen, onActions }: EntryListProps) {
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
            project={projects.has(entries[item.index].path)}
            openable={filesOpenable || entries[item.index].isDirectory}
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
  project: boolean;
  openable: boolean;
  top: number;
  onOpen: (entry: FileEntry) => void;
  onActions: (entry: FileEntry) => void;
}

function FileRow({ index, entry, project, openable, top, onOpen, onActions }: FileRowProps) {
  const kind = project ? 'PROJECT' : entry.isDirectory ? 'DIR' : formatSize(entry.sizeBytes);
  const content = (
    <>
      <span className={cx('caption', 'muted', styles.index)} aria-hidden>
        {String(index + 1).padStart(2, '0')}
      </span>
      {project ? (
        <span className={styles.badge} aria-hidden>
          <PepinoMark size={40} />
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
        <span className={cx('body', 'ellipsis', project && styles.projectName)}>
          {entry.name}
          {entry.isDirectory && !project && <span className="muted">/</span>}
        </span>
        <span className="caption muted ellipsis">
          <span className={cx(project && 'accent')}>{kind}</span>
          {'  ·  '}
          {formatModified(entry.modifiedMillis)}
        </span>
      </span>
    </>
  );

  return (
    <div className={styles.row} style={{ height: ROW_HEIGHT, transform: `translateY(${top}px)` }}>
      {openable ? (
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

function EmptyFolder({ spaceRoot }: { spaceRoot: boolean }) {
  return (
    <div className={styles.state}>
      <SliceOutline size={112} />
      <p className="title">{spaceRoot ? 'No projects yet' : 'Empty folder'}</p>
      <p className="caption muted">
        Tap <span className="accent">+ NEW</span>{' '}
        {spaceRoot ? 'to start your first project.' : 'to create a file or folder here.'}
      </p>
    </div>
  );
}
