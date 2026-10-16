import { useServices } from '../../app/services';
import { Button, Dialog } from '../../ui/components';
import { cx } from '../../ui/cx';
import type { FileEntry } from '../projects/files';
import { FolderPicker } from '../projects/FolderPicker';
import { type DirectoryListing, useDirectoryListing } from '../projects/useDirectoryListing';
import { useFolderStack } from '../projects/useFolderStack';
import styles from './GitScreen.module.css';
import { isGitDir, shown } from './locations';

/** Tags [folder] when [listing] says it is a git repository, in a folder picker. */
export function GitMark({ listing, folder }: { listing: DirectoryListing | null; folder: FileEntry }) {
  return listing?.ok && listing.repos.has(folder.path) ? (
    <span className={cx('caption', styles.mark, styles.markGit)}>GIT</span>
  ) : null;
}

/** Where a new repository goes: any folder of ~/projects, starting at [start]. */
export function LocationDialog({
  start,
  onClose,
  onChoose,
}: {
  start: string;
  onClose: () => void;
  onChoose: (path: string) => void;
}) {
  const { projectSpace } = useServices();
  const folders = useFolderStack('', start);
  const listing = useDirectoryListing(projectSpace, folders.path, 0, true);
  return (
    <Dialog
      title="Location"
      eyebrow="NEW REPOSITORY IN…"
      onClose={onClose}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="filled" disabled={listing?.ok !== true} onClick={() => onChoose(folders.path)}>
            Use this folder
          </Button>
        </>
      }
    >
      <FolderPicker
        folders={folders}
        listing={listing}
        rootLabel="~/projects"
        hide={isGitDir}
        mark={(folder) => <GitMark listing={listing} folder={folder} />}
      />
      <p className={cx('caption', 'muted', styles.pickStatus)}>The repository goes in {shown(folders.path)}.</p>
    </Dialog>
  );
}
