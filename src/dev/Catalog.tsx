import { useState } from 'react';
import { Button, Dialog, Divider, TextField } from '../ui/components';
import {
  BackIcon,
  BranchIcon,
  CloseIcon,
  FolderIcon,
  MoreIcon,
  PlusIcon,
  PromptIcon,
  SlidersIcon,
  SortIcon,
} from '../ui/icons';
import { PepinoMark, SliceOutline } from '../ui/Logo';
import { useSnackbar } from '../ui/useSnackbar';
import styles from './Catalog.module.css';

const SWATCHES = ['--pepino-black', '--pepino-panel', '--pepino-white', '--pepino-red', '--pepino-grey'];
const ICONS = { BackIcon, BranchIcon, CloseIcon, FolderIcon, MoreIcon, PlusIcon, PromptIcon, SlidersIcon, SortIcon };

export default function Catalog() {
  const showSnackbar = useSnackbar();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [text, setText] = useState('bad/name');

  return (
    <div className={styles.catalog}>
      <section className={styles.brand}>
        <PepinoMark size={64} />
        <SliceOutline size={64} />
        <div>
          <p className="display">Pepino</p>
          <p className="label">
            <span className="accent">//</span> Design system
          </p>
        </div>
      </section>
      <Divider />
      <section>
        <h2 className="label muted">Typography</h2>
        <p className="display">Display 30 · wide black</p>
        <p className="title">Title 19 · expanded</p>
        <p className="label">Label 12 · mono bold caps</p>
        <p className="body">Body 14 · src/features/projects/FileExplorer.tsx</p>
        <p className="caption muted">Caption 12 · 2026-10-15 10:42</p>
        <p className="label cursor">Working</p>
      </section>
      <Divider />
      <section>
        <h2 className="label muted">Colors</h2>
        <div className={styles.swatches}>
          {SWATCHES.map((name) => (
            <div key={name} className={styles.swatch}>
              <span style={{ background: `var(${name})` }} />
              <code className="caption">{name.replace('--pepino-', '')}</code>
            </div>
          ))}
        </div>
        <div className={styles.hazard} />
      </section>
      <Divider />
      <section>
        <h2 className="label muted">Icons</h2>
        <div className={styles.row}>
          {Object.entries(ICONS).map(([name, Icon]) => (
            <span key={name} className={styles.icon} title={name}>
              <Icon />
            </span>
          ))}
        </div>
      </section>
      <Divider />
      <section>
        <h2 className="label muted">Buttons</h2>
        <div className={styles.row}>
          <Button variant="filled">
            <PlusIcon size={18} />
            Filled
          </Button>
          <Button>Outlined</Button>
          <Button disabled>Disabled</Button>
          <Button variant="text">Text</Button>
          <Button variant="text" tone="danger">
            Danger
          </Button>
          <Button square aria-label="Back">
            <BackIcon size={20} />
          </Button>
        </div>
      </section>
      <Divider subtle />
      <section>
        <h2 className="label muted">Text field</h2>
        <TextField
          label="Name"
          prefix=">"
          value={text}
          onChange={setText}
          error={text.includes('/') ? 'Invalid name' : null}
        />
      </section>
      <Divider subtle />
      <section>
        <h2 className="label muted">Overlays</h2>
        <div className={styles.row}>
          <Button onClick={() => setDialogOpen(true)}>Dialog</Button>
          <Button onClick={() => showSnackbar('Hello from Pepino')}>Snackbar</Button>
        </div>
      </section>
      {dialogOpen && (
        <Dialog
          title="Dialog title"
          eyebrow="EYEBROW · context"
          onClose={() => setDialogOpen(false)}
          actions={
            <>
              <Button variant="text" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button variant="filled" onClick={() => setDialogOpen(false)}>
                Confirm
              </Button>
            </>
          }
        >
          <p className="body">Escape, ×, the backdrop and the Android back button close it.</p>
        </Dialog>
      )}
    </div>
  );
}
