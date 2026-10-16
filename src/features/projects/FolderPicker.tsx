import type { ReactNode } from 'react';
import { Button } from '../../ui/components';
import { cx } from '../../ui/cx';
import { BackIcon, FolderIcon } from '../../ui/icons';
import { Breadcrumb } from './Breadcrumb';
import styles from './FileExplorer.module.css';
import { type FileEntry, sortEntries } from './files';
import type { DirectoryListing } from './useDirectoryListing';
import type { FolderStack } from './useFolderStack';

/**
 * Picks a folder inside a dialog: the location, with a way up, and the
 * subfolders of [listing] (the current folder's) to walk into. [hide] leaves
 * folders out; [mark] adds a tag after a folder's name.
 */
export function FolderPicker({
  folders,
  listing,
  rootLabel,
  hide,
  mark,
}: {
  folders: FolderStack;
  listing: DirectoryListing | null;
  rootLabel: ReactNode;
  hide?: (folder: FileEntry) => boolean;
  mark?: (folder: FileEntry) => ReactNode;
}) {
  const subfolders = listing?.ok
    ? sortEntries(
        listing.entries.filter((entry) => entry.isDirectory && !hide?.(entry)),
        'name',
      )
    : [];

  return (
    <>
      <div className={styles.pickerBar}>
        <Button square disabled={!folders.canGoUp} onClick={folders.goUp} aria-label="Up one folder">
          <BackIcon size={20} />
        </Button>
        <Breadcrumb stack={folders.stack} rootLabel={rootLabel} onJump={folders.jump} />
      </div>
      {listing === null ? (
        <p className={cx('label', 'cursor', styles.pickerMessage)}>Reading</p>
      ) : !listing.ok ? (
        <p className={cx('label', 'accent', styles.pickerMessage)}>✕ Can&apos;t read folder</p>
      ) : subfolders.length === 0 ? (
        <p className={cx('label', 'muted', styles.pickerMessage)}>No subfolders</p>
      ) : (
        <div className={styles.pickerList}>
          {subfolders.map((folder) => (
            <Button
              key={folder.path}
              variant="text"
              listItem
              className={cx('body', styles.pickerFolder)}
              onClick={() => folders.enter(folder.path)}
            >
              <FolderIcon size={20} />
              <span className="ellipsis">{folder.name}</span>
              {mark?.(folder)}
            </Button>
          ))}
        </div>
      )}
    </>
  );
}
