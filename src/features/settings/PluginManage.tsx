import { useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import { Button, Dialog, TextField } from '../../ui/components';
import { cx } from '../../ui/cx';
import { useSnackbar } from '../../ui/useSnackbar';
import { errorMessage } from '../projects/errors';
import type { PluginManifest, SecretDeclaration, SettingValue } from '../plugins/manifest';
import { SecretDialog } from '../plugins/PluginPrompts';
import { PERMISSION_INFO } from '../plugins/permissions';
import styles from './SettingsScreen.module.css';
import { usePlugins } from './usePlugins';

/**
 * Managing one plugin (#57): what it is allowed (and taking it back), its
 * settings, what it brings to Pepino, and its log.
 */
export function PluginManage({ id, onClose }: { id: string; onClose: () => void }) {
  const { plugins } = useServices();
  const showSnackbar = useSnackbar();
  const { entries } = usePlugins();
  const entry = entries.find((candidate) => candidate.plugin.manifest.id === id);
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(
      Object.entries(plugins.settings(id)).map(([key, value]) => [
        key,
        typeof value === 'boolean' ? value : String(value),
      ]),
    ),
  );
  // Gone (uninstalled) while open
  if (!entry) return null;
  const { manifest, builtin } = entry.plugin;
  const allowed = manifest.permissions.filter((permission) => !entry.missing.includes(permission));
  const saved = plugins.settings(id);
  const log = plugins.log(id);

  const parsed: Record<string, SettingValue> = {};
  const errors: Record<string, string> = {};
  for (const setting of manifest.contributes.settings) {
    const value = values[setting.key];
    if (setting.type === 'boolean') parsed[setting.key] = value === true;
    else if (setting.type === 'string') parsed[setting.key] = String(value);
    else if (String(value).trim() === '' || !Number.isFinite(Number(value))) errors[setting.key] = 'A number';
    else parsed[setting.key] = Number(value);
  }
  const changed = Object.keys(parsed).some((key) => parsed[key] !== saved[key]);
  const valid = Object.keys(errors).length === 0;

  const act = (work: Promise<void>, done: string) =>
    work.then(
      () => showSnackbar(done),
      (error: unknown) => showSnackbar(`Error: ${errorMessage(error)}`),
    );

  return (
    <Dialog title={manifest.name} eyebrow={`PLUGIN · ${manifest.id} · v${manifest.version}`} onClose={onClose}>
      <div className={styles.manage}>
        <p className="caption muted">
          {builtin ? 'Comes with Pepino.' : 'Installed from EricMaton/pepino-plugins.'}
          {manifest.description && ` ${manifest.description}`}
        </p>

        <section className={styles.manageSection} aria-label="Permissions">
          <h3 className="label muted">Permissions</h3>
          {manifest.permissions.length === 0 ? (
            <p className="caption">It asks for none.</p>
          ) : (
            <ul className={styles.manageList}>
              {manifest.permissions.map((permission) => (
                <li key={permission}>
                  <span className="body">{PERMISSION_INFO[permission].title}</span>
                  <span className="caption muted"> · {PERMISSION_INFO[permission].detail}</span>
                  <span className={cx('caption', !allowed.includes(permission) && styles.expired)}>
                    {' '}
                    · {allowed.includes(permission) ? 'Allowed' : 'Not allowed'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {allowed.length > 0 && (
            <Button
              variant="outlined"
              className={styles.cardAction}
              onClick={() => void act(plugins.revoke(id), `${manifest.name} is off until you allow it again`)}
            >
              Take back permissions
            </Button>
          )}
        </section>

        {manifest.secrets.length > 0 && <Secrets manifest={manifest} />}

        {manifest.contributes.settings.length > 0 && (
          <section className={styles.manageSection} aria-label="Settings">
            <h3 className="label muted">Settings</h3>
            {manifest.contributes.settings.map((setting) =>
              setting.type === 'boolean' ? (
                <button
                  key={setting.key}
                  type="button"
                  role="switch"
                  aria-checked={values[setting.key] === true}
                  className={styles.toggle}
                  onClick={() => setValues({ ...values, [setting.key]: values[setting.key] !== true })}
                >
                  <span className={cx('body', styles.rowText)}>{setting.title ?? setting.key}</span>
                  <span
                    className={cx('label', styles.switch, values[setting.key] === true && styles.switchOn)}
                    aria-hidden
                  >
                    {values[setting.key] === true ? 'ON' : 'OFF'}
                  </span>
                </button>
              ) : (
                <TextField
                  key={setting.key}
                  label={setting.title ?? setting.key}
                  value={String(values[setting.key])}
                  error={errors[setting.key] ?? null}
                  onChange={(value) => setValues({ ...values, [setting.key]: value })}
                />
              ),
            )}
            <Button
              variant="filled"
              className={styles.cardAction}
              disabled={!changed || !valid}
              onClick={() => void act(plugins.setSettings(id, parsed), `${manifest.name}: settings saved`)}
            >
              Save settings
            </Button>
          </section>
        )}

        {(manifest.contributes.commands.length > 0 || manifest.contributes.themes.length > 0) && (
          <section className={styles.manageSection} aria-label="What it brings">
            <h3 className="label muted">What it brings</h3>
            <ul className={styles.manageList}>
              {manifest.contributes.commands.map((command) => (
                <li key={`command:${command.id}`} className="body">
                  <span className="accent">›</span> {manifest.name}: {command.title}
                  <span className="caption muted"> · command</span>
                </li>
              ))}
              {manifest.contributes.themes.map((theme) => (
                <li key={`theme:${theme.id}`} className="body">
                  {theme.label}
                  <span className="caption muted"> · {theme.base} theme, in SETTINGS → Appearance</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className={styles.manageSection} aria-label="Log">
          <h3 className="label muted">Log</h3>
          <ol className={styles.log} aria-label={`${manifest.name}'s log`}>
            {log.length === 0 && <li className="caption muted">Nothing yet.</li>}
            {log.map((line, i) => (
              <li key={i} className={cx('caption', line.level === 'error' && styles.expired)}>
                <span className="muted">{new Date(line.time).toLocaleTimeString()}</span> {line.text}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </Dialog>
  );
}

/** The plugin's keys of the user's own (#186): whether each is saved, to save, change or forget. */
function Secrets({ manifest }: { manifest: PluginManifest }) {
  const { pluginHost } = useServices();
  const showSnackbar = useSnackbar();
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [checked, setChecked] = useState(0);
  const [entering, setEntering] = useState<SecretDeclaration | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all(
      manifest.secrets.map(async ({ key }) => [key, await pluginHost.hasSecret(manifest, key)] as const),
    ).then(
      (found) => active && setSaved(Object.fromEntries(found)),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [pluginHost, manifest, checked]);

  const act = (work: Promise<void>, done: string) =>
    work.then(
      () => {
        setChecked((count) => count + 1);
        showSnackbar(done);
      },
      (error: unknown) => showSnackbar(`Error: ${errorMessage(error)}`),
    );

  return (
    <section className={styles.manageSection} aria-label="Your keys">
      <h3 className="label muted">Your keys</h3>
      {manifest.secrets.map((secret) => (
        <div key={secret.key} className={styles.manageSection}>
          <p>
            <span className="body">{secret.label}</span>
            <span className={cx('caption', !saved[secret.key] && 'muted')}>
              {' '}
              · {saved[secret.key] ? `Saved, only sent to ${secret.host}` : 'Not set'}
            </span>
          </p>
          <div className={styles.cardButtons}>
            <Button variant="outlined" onClick={() => setEntering(secret)}>
              {saved[secret.key] ? 'Change' : 'Set'}
            </Button>
            {saved[secret.key] && (
              <Button
                variant="text"
                onClick={() => void act(pluginHost.forgetSecret(manifest, secret.key), `${secret.label} forgotten`)}
              >
                Forget
              </Button>
            )}
          </div>
        </div>
      ))}
      {entering && (
        <SecretDialog
          label={entering.label}
          plugin={manifest.name}
          host={entering.host}
          help={entering.help}
          replacing={saved[entering.key]}
          onAnswer={(value) => {
            const secret = entering;
            setEntering(null);
            if (value) void act(pluginHost.saveSecret(manifest, secret.key, value), `${secret.label} saved`);
          }}
        />
      )}
    </section>
  );
}
