import { useState } from 'react';
import { useServices } from '../../app/services';
import { useBackHandler } from '../../ui/back';
import { Button } from '../../ui/components';
import { cx } from '../../ui/cx';
import { CloseIcon, FolderIcon } from '../../ui/icons';
import { PepinoMark } from '../../ui/Logo';
import { fileBadge, sortEntries } from '../projects/files';
import { basename, parentPath } from '../projects/paths';
import { useDirectoryListing } from '../projects/useDirectoryListing';
import { useFolderChanges } from '../projects/useFolderChanges';
import { useWorkspaceState } from './useWorkspace';
import styles from './WorkspaceDrawer.module.css';

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

/** Side panel with the workspace's open files and file tree, laid over the editor. */
export function WorkspaceDrawer({ onClose, onOpenFile }: { onClose: () => void; onOpenFile: (path: string) => void }) {
  const { workspace } = useServices();
  const { root, activeFile, openFiles } = useWorkspaceState(workspace);
  const [expanded, setExpanded] = useState(() => ancestors(activeFile, root));
  useBackHandler(true, onClose);

  const toggle = (folder: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });

  return (
    <>
      <div className={styles.scrim} onClick={onClose} aria-hidden />
      <aside className={styles.drawer} aria-label="Project files">
        <header className={styles.header}>
          <PepinoMark size={28} />
          <div className={styles.heading}>
            <span className="caption muted">WORKSPACE</span>
            <h2 className="title ellipsis">{root === '' ? '~/projects' : basename(root)}</h2>
          </div>
          <Button variant="text" square aria-label="Close project files" onClick={onClose}>
            <CloseIcon />
          </Button>
        </header>
        <div className={styles.scroll}>
          {openFiles.length > 0 && (
            <section aria-label="Open files">
              <h3 className={cx('label', 'muted', styles.section)}>
                <span className="accent">//</span> Open files
              </h3>
              {openFiles.map((path) => (
                <button
                  key={path}
                  type="button"
                  className={cx(styles.item, path === activeFile && styles.active)}
                  aria-current={path === activeFile ? 'true' : undefined}
                  onClick={() => onOpenFile(path)}
                >
                  <span className={cx('caption', styles.badge)} aria-hidden>
                    {fileBadge(basename(path))}
                  </span>
                  <span className={styles.itemText}>
                    <span className="body ellipsis">{basename(path)}</span>
                    <span className="caption muted ellipsis">{folderOf(path, root)}</span>
                  </span>
                </button>
              ))}
            </section>
          )}
          <section aria-label="Files">
            <h3 className={cx('label', 'muted', styles.section)}>
              <span className="accent">//</span> Files
            </h3>
            <div role="tree">
              <Folder
                path={root}
                depth={0}
                expanded={expanded}
                activeFile={activeFile}
                onToggle={toggle}
                onOpenFile={onOpenFile}
              />
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}

interface FolderProps {
  path: string;
  depth: number;
  expanded: ReadonlySet<string>;
  activeFile: string | null;
  onToggle: (folder: string) => void;
  onOpenFile: (path: string) => void;
}

/** Children of an expanded folder; collapsed folders never touch the disk. */
function Folder({ path, depth, expanded, activeFile, onToggle, onOpenFile }: FolderProps) {
  const { projectSpace } = useServices();
  const [tick, setTick] = useState(0);
  useFolderChanges(path, () => setTick((value) => value + 1));
  const listing = useDirectoryListing(projectSpace, path, tick);
  const indent = { paddingLeft: `calc(var(--space-3) + ${depth} * 16px)` };

  if (listing === null)
    return (
      <p className={cx('caption', 'muted', styles.note)} style={indent}>
        …
      </p>
    );
  if (!listing.ok)
    return (
      <p className={cx('caption', 'accent', styles.note)} style={indent}>
        ✕ {listing.message}
      </p>
    );
  if (listing.entries.length === 0) {
    return (
      <p className={cx('caption', 'muted', styles.note)} style={indent}>
        empty
      </p>
    );
  }

  return (
    <>
      {sortEntries(listing.entries, 'name').map((entry) =>
        entry.isDirectory ? (
          <div key={entry.path} role="treeitem" aria-expanded={expanded.has(entry.path)}>
            <button type="button" className={styles.item} style={indent} onClick={() => onToggle(entry.path)}>
              <span className={styles.chevron} aria-hidden>
                {expanded.has(entry.path) ? '▾' : '▸'}
              </span>
              <FolderIcon size={18} />
              <span className="body ellipsis">{entry.name}</span>
            </button>
            {expanded.has(entry.path) && (
              <div role="group">
                <Folder
                  path={entry.path}
                  depth={depth + 1}
                  expanded={expanded}
                  activeFile={activeFile}
                  onToggle={onToggle}
                  onOpenFile={onOpenFile}
                />
              </div>
            )}
          </div>
        ) : (
          <button
            key={entry.path}
            type="button"
            role="treeitem"
            className={cx(styles.item, entry.path === activeFile && styles.active)}
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
        ),
      )}
    </>
  );
}
