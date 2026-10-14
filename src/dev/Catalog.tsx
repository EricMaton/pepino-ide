import { useState } from 'react';
import { Button, Dialog, Divider, RedBar, TextField } from '../ui/components';
import { useSnackbar } from '../ui/useSnackbar';
import styles from './Catalog.module.css';

const SWATCHES = ['--pepino-black', '--pepino-panel', '--pepino-white', '--pepino-red', '--pepino-grey'];

export default function Catalog() {
  const showSnackbar = useSnackbar();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [text, setText] = useState('bad/name');

  return (
    <div className={styles.catalog}>
      <RedBar />
      <section>
        <h2 className="label muted">TYPOGRAPHY</h2>
        <p className="headline">HEADLINE 32 BLACK</p>
        <p className="title">TITLE 20 EXTRABOLD</p>
        <p className="label">LABEL 14 BOLD</p>
        <p className="body">Body 14 regular — the quick brown fox.</p>
        <p className="body mono">src/main.ts · mono</p>
      </section>
      <Divider />
      <section>
        <h2 className="label muted">COLORS</h2>
        <div className={styles.swatches}>
          {SWATCHES.map((name) => (
            <div key={name} className={styles.swatch}>
              <span style={{ background: `var(${name})` }} />
              <code className="label">{name.replace('--pepino-', '')}</code>
            </div>
          ))}
        </div>
      </section>
      <Divider />
      <section>
        <h2 className="label muted">BUTTONS</h2>
        <div className={styles.row}>
          <Button>Outlined</Button>
          <Button disabled>Disabled</Button>
          <Button variant="text">Text</Button>
          <Button variant="filled">Filled</Button>
          <Button variant="text" tone="danger">
            Danger
          </Button>
        </div>
      </section>
      <Divider subtle />
      <section>
        <h2 className="label muted">TEXT FIELD</h2>
        <TextField label="NAME" value={text} onChange={setText} error={text.includes('/') ? 'INVALID NAME' : null} />
      </section>
      <Divider subtle />
      <section>
        <h2 className="label muted">OVERLAYS</h2>
        <div className={styles.row}>
          <Button onClick={() => setDialogOpen(true)}>Dialog</Button>
          <Button onClick={() => showSnackbar('Hello from Pepino 🥒')}>Snackbar</Button>
        </div>
      </section>
      {dialogOpen && (
        <Dialog
          title="DIALOG TITLE"
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
          <p className="body">Dialog content. Escape, backdrop and the Android back button close it.</p>
        </Dialog>
      )}
    </div>
  );
}
