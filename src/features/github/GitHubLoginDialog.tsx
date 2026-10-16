import { useCallback, useEffect, useRef, useState } from 'react';
import { useServices } from '../../app/services';
import { Button, Dialog } from '../../ui/components';
import { cx } from '../../ui/cx';
import { type DeviceLogin, type GitHubAccount, GitHubError } from './github';
import styles from './GitHubLoginDialog.module.css';

type Step =
  { kind: 'starting' } | { kind: 'code'; login: DeviceLogin; copied: boolean } | { kind: 'failed'; error: GitHubError };

/** What went wrong, said plainly, and whether a new code may help. */
function explain(error: GitHubError): { title: string; detail: string; retry: boolean } {
  switch (error.code) {
    case 'EXPIRED':
      return { title: 'The code expired', detail: 'Codes last 15 minutes. Get a new one.', retry: true };
    case 'DENIED':
      return { title: 'Cancelled on GitHub', detail: 'Pepino was not given access. You can try again.', retry: true };
    case 'NETWORK':
      return { title: 'No connection to GitHub', detail: 'Check the connection and try again.', retry: true };
    case 'DISABLED':
      return {
        title: 'Device sign-in is off',
        detail: 'Pepino’s GitHub app needs “Enable Device Flow” in its settings on GitHub.',
        retry: false,
      };
    default:
      return { title: 'Sign-in failed', detail: error.message, retry: true };
  }
}

/**
 * Signing in with GitHub's device flow: Pepino shows a code, the user opens
 * github.com/login/device, types it and approves. Pepino waits on its own
 * meanwhile, also while the browser is in front, and closes when it is done.
 */
export function GitHubLoginDialog({
  onClose,
  onSignedIn,
}: {
  onClose: () => void;
  onSignedIn: (account: GitHubAccount) => void;
}) {
  const { github } = useServices();
  const [step, setStep] = useState<Step>({ kind: 'starting' });
  const [attempt, setAttempt] = useState(0);
  const finished = useRef(false);
  const latestSignedIn = useRef(onSignedIn);
  useEffect(() => {
    latestSignedIn.current = onSignedIn;
  });

  useEffect(() => {
    let active = true;
    const fail = (error: unknown) => {
      if (!active) return;
      const failure = error instanceof GitHubError ? error : new GitHubError('FAILED', String(error));
      if (failure.code !== 'CANCELLED') setStep({ kind: 'failed', error: failure });
    };
    github.startLogin().then((login) => {
      if (!active) return;
      setStep({ kind: 'code', login, copied: false });
      github.finishLogin().then((account) => {
        finished.current = true;
        if (active) latestSignedIn.current(account);
      }, fail);
    }, fail);
    return () => {
      active = false;
    };
  }, [github, attempt]);

  // Closing (back, ✕, Cancel) stops the waiting, unless it already ended.
  const close = useCallback(() => {
    if (!finished.current) void github.cancelLogin();
    onClose();
  }, [github, onClose]);

  const openGitHub = (login: DeviceLogin) => {
    // The code goes to the clipboard first: on GitHub's page it is one paste.
    void navigator.clipboard?.writeText(login.userCode).catch(() => undefined);
    setStep({ kind: 'code', login, copied: true });
    void github.openUrl(login.verificationUri);
  };

  return (
    <Dialog
      title="Sign in with GitHub"
      eyebrow="DEVICE CODE"
      onClose={close}
      actions={
        step.kind === 'failed' && explain(step.error).retry ? (
          <>
            <Button variant="text" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="filled"
              onClick={() => {
                setStep({ kind: 'starting' });
                setAttempt((value) => value + 1);
              }}
            >
              New code
            </Button>
          </>
        ) : (
          <Button variant="text" onClick={close}>
            Cancel
          </Button>
        )
      }
    >
      {step.kind === 'starting' ? (
        <p className={cx('label', 'cursor', styles.waiting)} data-loading>
          Asking GitHub for a code
        </p>
      ) : step.kind === 'code' ? (
        <div className={styles.login}>
          <p className="caption muted">1. Copy this code and open GitHub:</p>
          <output className={styles.userCode} aria-label="Code to enter on GitHub">
            {step.login.userCode}
          </output>
          <Button variant="filled" onClick={() => openGitHub(step.login)}>
            {step.copied ? 'Copied · open GitHub again' : 'Copy code and open GitHub'}
          </Button>
          <p className="caption muted">
            2. Paste it on <strong>{step.login.verificationUri.replace(/^https:\/\//, '')}</strong> and approve Pepino.
            3. Come back: Pepino notices by itself.
          </p>
          <p className={cx('label', 'cursor', styles.waiting)} role="status">
            Waiting for GitHub
          </p>
        </div>
      ) : (
        <div className={styles.login} role="alert">
          <p className="title">{explain(step.error).title}</p>
          <p className="caption muted">{explain(step.error).detail}</p>
        </div>
      )}
    </Dialog>
  );
}
