import { type ReactNode, useState } from 'react';
import { useServices } from '../../app/services';
import { useBackHandler } from '../../ui/back';
import { Button } from '../../ui/components';
import { cx } from '../../ui/cx';
import { CloseIcon, FolderIcon, MoreIcon, PlusIcon, TreeIcon } from '../../ui/icons';
import { useSnackbar } from '../../ui/useSnackbar';
import { errorMessage } from '../projects/errors';
import {
  CreateEntryDialog,
  DeleteEntryDialog,
  EntryActionsDialog,
  type ExplorerDialog,
  RenameEntryDialog,
  TransferDialog,
} from '../projects/ExplorerDialogs';
import { EmptyFolder } from '../projects/FileExplorer';
import { type FileEntry, fileBadge, sortEntries } from '../projects/files';
import { basename, joinPath, parentPath } from '../projects/paths';
import { useDirectoryListing } from '../projects/useDirectoryListing';
import { useFolderChanges } from '../projects/useFolderChanges';
import { useWorkspaceState } from './useWorkspace';
import styles from './WorkspaceDrawer.module.css';

/** Explorer dialogs, plus "create inside this folder". */
type DrawerDialog = Exclude<ExplorerDialog, { kind: 'create' }> | { kind: 'create'; folder: string };

/** Every folder between [root] and [file], so the active file starts visible. */
function ancestors(file: string | null, root: string): Set<string> {
  const open = new Set<string>([root]);
  for (let dir = file ? parentPath(file) : root; dir !== root && dir !== ''; dir = parentPath(dir)) open.add(dir);
  return open;
}

/** Path shown under a file name: its folder, relative to the workspace root. */
function folderOf(path: string, root: string): string {
  const folder = parentPath(path);
  const relative = root === '' ? folder : folder.slice(root.length + 1);
  return relative || '/';
}

/** Side panel laid over the editor with the workspace's file tree: the tree is a tap away from any tab. */
export function WorkspaceDrawer({ onClose, onOpenFile }: { onClose: () => void; onOpenFile: (path: string) => void }) {
  const { workspace } = useServices();
  const { root } = useWorkspaceState(workspace);
  useBackHandler(true, onClose);

  return (
    <>
      <div className={styles.scrim} onClick={onClose} aria-hidden />
      <aside className={styles.drawer} aria-label="Project files">
        <WorkspaceTree
          onOpenFile={onOpenFile}
          header={(createAtRoot) => (
            <header className={styles.header}>
              <div className={styles.heading}>
                <span className="caption muted">WORKSPACE</span>
                <h2 className="title ellipsis">{basename(root)}</h2>
              </div>
              <Button variant="text" square aria-label="New file or folder" onClick={createAtRoot}>
                <PlusIcon size={20} />
              </Button>
              <Button variant="text" square aria-label="Close project files" onClick={onClose}>
                <CloseIcon />
              </Button>
            </header>
          )}
        />
      </aside>
    </>
  );
}

/** The workspace with no file open: its tree takes the whole screen (like VS Code's explorer). */
export function WorkspaceHome({ onOpenFile }: { onOpenFile: (path: string) => void }) {
  return (
    <div className={styles.home}>
      <WorkspaceTree
        onOpenFile={onOpenFile}
        empty={<EmptyFolder title="Empty project" />}
        header={(createAtRoot) => (
          <div className={styles.homeBar}>
            <TreeIcon size={20} />
            <span className="label muted">
              <span className="accent">//</span> Files
            </span>
            <span className={styles.homeSpacer} />
            <Button square aria-label="New file or folder" onClick={createAtRoot}>
              <PlusIcon size={22} />
            </Button>
          </div>
        )}
      />
    </div>
  );
}

/**
 * The workspace's file tree with the usual file actions (create, rename,
 * move, copy, delete). Changes go through the project space, so the tree,
 * the explorer and the open editor all follow them.
 */
function WorkspaceTree({
  onOpenFile,
  header,
  empty,
}: {
  onOpenFile: (path: string) => void;
  /** Above the tree; [createAtRoot] starts "new file or folder" at the root. */
  header: (createAtRoot: () => void) => ReactNode;
  /** Instead of "empty" when the root has nothing in it. */
  empty?: ReactNode;
}) {
  const { workspace, projectSpace } = useServices();
  const showSnackbar = useSnackbar();
  const { root, activeFile } = useWorkspaceState(workspace);
  const [expanded, setExpanded] = useState(() => ancestors(activeFile, root));
  const [dialog, setDialog] = useState<DrawerDialog | null>(null);

  const rootName = basename(root);
  const toggle = (folder: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });

  const run = (operation: () => Promise<unknown>) => {
    setDialog(null);
    operation().catch((error: unknown) => showSnackbar(`Error: ${errorMessage(error)}`));
  };

  return (
    <>
      {header(() => setDialog({ kind: 'create', folder: root }))}
      <div className={styles.scroll}>
        <div role="tree" aria-label="Files">
          <Folder
            path={root}
            depth={0}
            expanded={expanded}
            activeFile={activeFile}
            empty={empty}
            onToggle={toggle}
            onOpenFile={onOpenFile}
            onActions={(entry) => setDialog({ kind: 'actions', entry, project: false })}
          />
        </div>
      </div>

      {dialog?.kind === 'create' && (
        <CreateEntryDialog
          where={dialog.folder === root ? rootName : `${rootName}/${folderOf(joinPath(dialog.folder, 'x'), root)}`}
          onClose={() => setDialog(null)}
          onCreate={(kind, name) => {
            const path = joinPath(dialog.folder, name);
            setExpanded((current) => new Set(current).add(dialog.folder));
            run(async () => {
              if (kind === 'folder') return projectSpace.createDirectory(path);
              await projectSpace.createFile(path);
              onOpenFile(path); // a new file is opened right away
            });
          }}
        />
      )}
      {dialog?.kind === 'actions' && (
        <EntryActionsDialog
          entry={dialog.entry}
          project={false}
          extraActions={
            dialog.entry.isDirectory
              ? [
                  {
                    label: 'New file or folder here',
                    run: () => setDialog({ kind: 'create', folder: dialog.entry.path }),
                  },
                ]
              : []
          }
          onClose={() => setDialog(null)}
          onAction={(next) => setDialog(next.kind === 'create' ? null : next)}
        />
      )}
      {dialog?.kind === 'rename' && (
        <RenameEntryDialog
          entry={dialog.entry}
          project={false}
          onClose={() => setDialog(null)}
          onRename={(newName) => run(() => projectSpace.rename(dialog.entry.path, newName))}
        />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteEntryDialog
          entry={dialog.entry}
          project={false}
          onClose={() => setDialog(null)}
          onConfirm={() => run(() => projectSpace.delete(dialog.entry.path))}
        />
      )}
      {dialog?.kind === 'transfer' && (
        <TransferDialog
          entry={dialog.entry}
          project={false}
          move={dialog.move}
          projectSpace={projectSpace}
          rootPath={root}
          rootLabel="/"
          onClose={() => setDialog(null)}
          onConfirm={(destination) =>
            run(() =>
              dialog.move
                ? projectSpace.move(dialog.entry.path, destination)
                : projectSpace.copy(dialog.entry.path, destination),
            )
          }
        />
      )}
    </>
  );
}

interface FolderProps {
  path: string;
  depth: number;
  expanded: ReadonlySet<string>;
  activeFile: string | null;
  /** Shown instead of "empty" when this folder has nothing in it. */
  empty?: ReactNode;
  onToggle: (folder: string) => void;
  onOpenFile: (path: string) => void;
  onActions: (entry: FileEntry) => void;
}

/** Children of an expanded folder; collapsed folders never touch the disk. */
function Folder({ path, depth, expanded, activeFile, empty, onToggle, onOpenFile, onActions }: FolderProps) {
  const { projectSpace } = useServices();
  const [tick, setTick] = useState(0);
  useFolderChanges(path, () => setTick((value) => value + 1));
  const listing = useDirectoryListing(projectSpace, path, tick);
  const indent = { paddingLeft: `calc(var(--space-3) + ${depth} * 16px)` };
  const note = (text: string, tone = 'muted') => (
    <p className={cx('caption', tone, styles.note)} style={indent}>
      {text}
    </p>
  );

  if (listing === null) {
    return (
      <p className={cx('caption', 'muted', styles.note)} style={indent} data-loading>
        …
      </p>
    );
  }
  if (!listing.ok) return note(`✕ ${listing.message}`, 'accent');
  if (listing.entries.length === 0) return empty ?? note('empty');

  return (
    <>
      {sortEntries(listing.entries, 'name').map((entry) => {
        const more = (
          <Button
            variant="text"
            square
            className={cx('muted', styles.more)}
            aria-label={`Actions for ${entry.name}`}
            onClick={() => onActions(entry)}
          >
            <MoreIcon size={16} />
          </Button>
        );
        return entry.isDirectory ? (
          <div key={entry.path} role="treeitem" aria-expanded={expanded.has(entry.path)}>
            <div className={styles.row}>
              <button type="button" className={styles.item} style={indent} onClick={() => onToggle(entry.path)}>
                <span className={styles.chevron} aria-hidden>
                  {expanded.has(entry.path) ? '▾' : '▸'}
                </span>
                <FolderIcon size={18} />
                <span className="body ellipsis">{entry.name}</span>
              </button>
              {more}
            </div>
            {expanded.has(entry.path) && (
              <div role="group">
                <Folder
                  path={entry.path}
                  depth={depth + 1}
                  expanded={expanded}
                  activeFile={activeFile}
                  onToggle={onToggle}
                  onOpenFile={onOpenFile}
                  onActions={onActions}
                />
              </div>
            )}
          </div>
        ) : (
          <div key={entry.path} role="treeitem" className={cx(styles.row, entry.path === activeFile && styles.active)}>
            <button
              type="button"
              className={styles.item}
              style={indent}
              aria-current={entry.path === activeFile ? 'true' : undefined}
              onClick={() => onOpenFile(entry.path)}
            >
              <span className={styles.chevron} aria-hidden />
              <span className={cx('caption', styles.badge)} aria-hidden>
                {fileBadge(entry.name)}
              </span>
              <span className="body ellipsis">{entry.name}</span>
            </button>
            {more}
          </div>
        );
      })}
    </>
  );
}
