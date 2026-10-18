import { useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import { Button, Dialog } from '../../ui/components';
import { cx } from '../../ui/cx';
import { useSnackbar } from '../../ui/useSnackbar';
import { errorMessage } from '../projects/errors';
import { SUPPORTED_API_VERSIONS } from '../plugins/manifest';
import { PERMISSION_INFO } from '../plugins/permissions';
import type { RegistryEntry } from '../plugins/registry';
import styles from './SettingsScreen.module.css';
import { usePlugins } from './usePlugins';

type Index = { state: 'loading' } | { state: 'ready'; entries: RegistryEntry[] } | { state: 'failed'; error: string };

/** [a] is a newer x.y.z than [b]. */
function newer(a: string, b: string): boolean {
  const parts = (version: string) => version.split(/[-+]/)[0].split('.').map(Number);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

/** Available (#56): the plugins in the repository, to install, or update when a newer version is there. */
export function PluginCatalog() {
  const { pluginRegistry, plugins } = useServices();
  const showSnackbar = useSnackbar();
  const { entries } = usePlugins();
  const [attempt, setAttempt] = useState(0);
  const [index, setIndex] = useState<Index>({ state: 'loading' });
  const [confirming, setConfirming] = useState<RegistryEntry | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    pluginRegistry.list().then(
      (listed) => active && setIndex({ state: 'ready', entries: listed }),
      (error: unknown) => active && setIndex({ state: 'failed', error: errorMessage(error) }),
    );
    return () => {
      active = false;
    };
  }, [pluginRegistry, attempt]);

  const install = async (entry: RegistryEntry) => {
    const update = entries.some((installed) => installed.plugin.manifest.id === entry.id);
    setBusy(entry.id);
    try {
      await plugins.install(await pluginRegistry.download(entry), entry);
      showSnackbar(update ? `Updated ${entry.name} to v${entry.version}` : `Installed ${entry.name}`);
    } catch (error) {
      showSnackbar(`Error: ${errorMessage(error)}`);
    } finally {
      setBusy(null);
    }
  };

  if (index.state === 'loading') {
    return <p className={cx('caption', 'muted', styles.note)}>Reading the plugins repository…</p>;
  }
  if (index.state === 'failed') {
    return (
      <section className={styles.card} aria-label="Plugins repository">
        <p className={cx('caption', styles.cardNote, styles.expired)}>{index.error}</p>
        <Button
          variant="filled"
          className={styles.cardAction}
          onClick={() => {
            setIndex({ state: 'loading' });
            setAttempt((count) => count + 1);
          }}
        >
          Try again
        </Button>
      </section>
    );
  }

  return (
    <>
      {index.entries.length === 0 && <p className={cx('caption', 'muted', styles.note)}>No plugins there yet.</p>}
      {index.entries.map((entry) => {
        const installed = entries.find((candidate) => candidate.plugin.manifest.id === entry.id)?.plugin;
        const runs = SUPPORTED_API_VERSIONS.includes(entry.apiVersion);
        const action = !runs
          ? null
          : !installed
            ? 'Install'
            : !installed.builtin && newer(entry.version, installed.manifest.version)
              ? `Update to v${entry.version}`
              : null;
        const status = !runs
          ? 'Needs a newer Pepino'
          : installed?.builtin
            ? 'Comes with Pepino'
            : installed
              ? action
                ? `v${installed.manifest.version} installed`
                : 'Installed'
              : null;
        return (
          <section key={entry.id} className={styles.card} aria-label={`Available: ${entry.name}`}>
            <span className={styles.rowText}>
              <span className="body">{entry.name}</span>
              <span className="caption muted">
                v{entry.version}
                {status && ` · ${status}`}
              </span>
            </span>
            {entry.description && <p className={cx('caption', 'muted', styles.cardNote)}>{entry.description}</p>}
            <p className={cx('caption', styles.cardNote)}>
              {entry.permissions.length === 0
                ? 'Asks for no permissions.'
                : `May: ${entry.permissions.map((permission) => PERMISSION_INFO[permission].title.toLowerCase()).join(', ')}.`}
            </p>
            {action && (
              <Button
                variant="filled"
                className={styles.cardAction}
                disabled={busy !== null}
                onClick={() => setConfirming(entry)}
              >
                {busy === entry.id ? 'Installing…' : action}
              </Button>
            )}
          </section>
        );
      })}
      {confirming && (
        <InstallDialog
          entry={confirming}
          onClose={() => setConfirming(null)}
          onInstall={() => {
            setConfirming(null);
            void install(confirming);
          }}
        />
      )}
    </>
  );
}

/** What a plugin will be allowed, shown before it is downloaded (spec v1: permissions are approved at install). */
function InstallDialog({
  entry,
  onClose,
  onInstall,
}: {
  entry: RegistryEntry;
  onClose: () => void;
  onInstall: () => void;
}) {
  return (
    <Dialog
      title={`Install ${entry.name}?`}
      eyebrow={`PLUGIN · ${entry.id} · v${entry.version}`}
      onClose={onClose}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="filled" onClick={onInstall}>
            {entry.permissions.length ? 'Allow and install' : 'Install'}
          </Button>
        </>
      }
    >
      <div className={styles.permissions}>
        {entry.permissions.length === 0 ? (
          <p className="body">It asks for no permissions.</p>
        ) : (
          <>
            <p className="body">It asks to:</p>
            <ul>
              {entry.permissions.map((permission) => (
                <li key={permission}>
                  <span className="body">{PERMISSION_INFO[permission].title}</span>
                  <span className="caption muted"> · {PERMISSION_INFO[permission].detail}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="caption muted">
          From EricMaton/pepino-plugins on GitHub. Each file is checked against the repository&apos;s index before it is
          kept, and Pepino checks every call the plugin makes.
        </p>
      </div>
    </Dialog>
  );
}
