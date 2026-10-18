import { useState } from 'react';
import { useServices } from '../../app/services';
import { Button, Dialog } from '../../ui/components';
import { cx } from '../../ui/cx';
import { useSnackbar } from '../../ui/useSnackbar';
import { errorMessage } from '../projects/errors';
import type { PluginEntry, PluginEntryState } from '../plugins/manager';
import { PERMISSION_INFO } from '../plugins/permissions';
import { PluginManage } from './PluginManage';
import styles from './SettingsScreen.module.css';
import { usePlugins } from './usePlugins';

const STATE_LABELS: Record<PluginEntryState, string> = {
  starting: 'Starting',
  running: 'On',
  failed: 'Failed',
  off: 'Off',
  'needs-approval': 'Needs your approval',
};

/** Plugins (#49): each one, on or off, what it may do; approving what it asks for, and managing it (#57). */
export function Plugins() {
  const { plugins } = useServices();
  const showSnackbar = useSnackbar();
  const { entries, rejected } = usePlugins();
  const [reviewing, setReviewing] = useState<PluginEntry | null>(null);
  const [uninstalling, setUninstalling] = useState<PluginEntry | null>(null);
  const [managing, setManaging] = useState<string | null>(null);

  const act = (work: Promise<void>) => work.catch((error: unknown) => showSnackbar(`Error: ${errorMessage(error)}`));

  return (
    <>
      {entries.length === 0 && <p className={cx('caption', 'muted', styles.note)}>No plugins.</p>}
      {entries.map((entry) => (
        <PluginCard
          key={entry.plugin.manifest.id}
          entry={entry}
          onToggle={(on) => {
            if (on && entry.missing.length > 0) setReviewing(entry);
            else void act(plugins.setEnabled(entry.plugin.manifest.id, on));
          }}
          onReview={() => setReviewing(entry)}
          onUninstall={() => setUninstalling(entry)}
          onManage={() => setManaging(entry.plugin.manifest.id)}
        />
      ))}
      {rejected.map(({ origin, errors }) => (
        <section key={origin} className={styles.card} aria-label={`Not loaded: ${origin}`}>
          <span className="body">{origin}</span>
          <p className={cx('caption', styles.cardNote, styles.expired)}>Not loaded: {errors.join('; ')}</p>
        </section>
      ))}
      {reviewing && (
        <ApprovalDialog
          entry={reviewing}
          onClose={() => setReviewing(null)}
          onApprove={() => {
            setReviewing(null);
            void act(plugins.approve(reviewing.plugin.manifest.id));
          }}
        />
      )}
      {managing && <PluginManage id={managing} onClose={() => setManaging(null)} />}
      {uninstalling && (
        <Dialog
          title={`Uninstall ${uninstalling.plugin.manifest.name}?`}
          eyebrow={`PLUGIN · v${uninstalling.plugin.manifest.version}`}
          onClose={() => setUninstalling(null)}
          actions={
            <>
              <Button variant="text" onClick={() => setUninstalling(null)}>
                Cancel
              </Button>
              <Button
                variant="filled"
                onClick={() => {
                  const { id, name } = uninstalling.plugin.manifest;
                  setUninstalling(null);
                  void act(plugins.uninstall(id).then(() => showSnackbar(`Uninstalled ${name}`)));
                }}
              >
                Uninstall
              </Button>
            </>
          }
        >
          <p className="body">
            Its commands and themes go now, and so do what you allowed it and what it saved. You can install it again
            from Available.
          </p>
        </Dialog>
      )}
    </>
  );
}

function PluginCard({
  entry,
  onToggle,
  onReview,
  onUninstall,
  onManage,
}: {
  entry: PluginEntry;
  onToggle: (on: boolean) => void;
  onReview: () => void;
  onUninstall: () => void;
  onManage: () => void;
}) {
  const { manifest, builtin } = entry.plugin;
  const on = entry.state === 'running' || entry.state === 'starting';

  return (
    <section className={styles.card} aria-label={`Plugin: ${manifest.name}`}>
      <button type="button" role="switch" aria-checked={on} className={styles.toggle} onClick={() => onToggle(!on)}>
        <span className={styles.rowText}>
          <span className="body">{manifest.name}</span>
          <span className="caption muted">
            v{manifest.version} · {builtin ? 'Comes with Pepino' : 'Installed'} ·{' '}
            <span className={cx(entry.state === 'failed' && styles.expired)}>{STATE_LABELS[entry.state]}</span>
          </span>
        </span>
        <span className={cx('label', styles.switch, on && styles.switchOn)} aria-hidden>
          {on ? 'ON' : 'OFF'}
        </span>
      </button>
      {manifest.description && <p className={cx('caption', 'muted', styles.cardNote)}>{manifest.description}</p>}
      {entry.error && <p className={cx('caption', styles.cardNote, styles.expired)}>✕ {entry.error}</p>}
      <p className={cx('caption', styles.cardNote)}>
        {manifest.permissions.length === 0
          ? 'Asks for no permissions.'
          : `May: ${manifest.permissions.map((permission) => PERMISSION_INFO[permission].title.toLowerCase()).join(', ')}.`}
      </p>
      {entry.state === 'needs-approval' && (
        <Button variant="filled" className={styles.cardAction} onClick={onReview}>
          Review permissions
        </Button>
      )}
      <div className={styles.cardButtons}>
        <Button variant="outlined" onClick={onManage}>
          Manage
        </Button>
        {!builtin && (
          <Button variant="text" onClick={onUninstall}>
            Uninstall
          </Button>
        )}
      </div>
    </section>
  );
}

/** What a plugin asks for, to approve before it first runs (spec v1: approved at install). */
function ApprovalDialog({
  entry,
  onClose,
  onApprove,
}: {
  entry: PluginEntry;
  onClose: () => void;
  onApprove: () => void;
}) {
  const { manifest } = entry.plugin;
  return (
    <Dialog
      title={`Allow ${manifest.name}?`}
      eyebrow={`PLUGIN · ${manifest.id}`}
      onClose={onClose}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="filled" onClick={onApprove}>
            Allow and turn on
          </Button>
        </>
      }
    >
      <div className={styles.permissions}>
        <p className="body">It asks to:</p>
        <ul>
          {entry.missing.map((permission) => (
            <li key={permission}>
              <span className="body">{PERMISSION_INFO[permission].title}</span>
              <span className="caption muted"> · {PERMISSION_INFO[permission].detail}</span>
            </li>
          ))}
        </ul>
        {manifest.networkJustification && (
          <p className="caption">Why it needs the internet: {manifest.networkJustification}</p>
        )}
        <p className="caption muted">
          Pepino checks every call it makes: anything else it tries is refused, and shows in its log.
        </p>
      </div>
    </Dialog>
  );
}
