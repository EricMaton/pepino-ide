import { useState } from 'react';
import { useServices } from '../../app/services';
import { TopBar } from '../../app/TopBar';
import { Button, Dialog } from '../../ui/components';
import { cx } from '../../ui/cx';
import { useSnackbar } from '../../ui/useSnackbar';
import { type GitHubAccount, GitHubError } from '../github/github';
import { GitHubLoginDialog } from '../github/GitHubLoginDialog';
import { useGitHubAccount } from '../github/useGitHubAccount';
import { Appearance } from './Appearance';
import styles from './SettingsScreen.module.css';

/**
 * Settings: the accounts (GitHub, #29, which clone, push and pull requests
 * need) and the appearance (#44). Editor preferences and plugins come next.
 */
export function SettingsScreen({ subtitle }: { subtitle: string }) {
  const account = useGitHubAccount();
  return (
    <div className={styles.screen}>
      <TopBar title="Settings" subtitle={subtitle} label="Search commands · Settings" />
      <div className={styles.scroll}>
        <h2 className={cx('label', 'muted', styles.heading)}>
          <span className="accent">//</span> Accounts
        </h2>
        <GitHubAccountCard account={account} />
        <h2 className={cx('label', 'muted', styles.heading)}>
          <span className="accent">//</span> Appearance
        </h2>
        <Appearance />
      </div>
    </div>
  );
}

function GitHubAccountCard({ account }: { account: GitHubAccount | null | undefined }) {
  const { github } = useServices();
  const showSnackbar = useSnackbar();
  const [signingIn, setSigningIn] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const signOut = () => {
    setSigningOut(false);
    github.logout().catch((error: unknown) => showSnackbar(`Error: ${(error as GitHubError).message}`));
  };

  return (
    <section className={styles.card} aria-label="GitHub account">
      {account === undefined ? (
        <span hidden data-loading />
      ) : account ? (
        <>
          <div className={styles.account}>
            <Avatar account={account} />
            <span className={styles.accountText}>
              <span className="body ellipsis">{account.name ?? account.login}</span>
              <span className="caption muted ellipsis">@{account.login} · GitHub</span>
            </span>
          </div>
          {account.expired ? (
            <>
              <p className={cx('caption', styles.cardNote, styles.expired)} role="alert">
                GitHub no longer accepts this sign-in: it was revoked, or it expired. Sign in again to clone, push and
                open pull requests.
              </p>
              <Button variant="filled" className={styles.cardAction} onClick={() => setSigningIn(true)}>
                Sign in again
              </Button>
              <Button variant="text" tone="danger" className={styles.cardAction} onClick={() => setSigningOut(true)}>
                Sign out
              </Button>
            </>
          ) : (
            <>
              <p className={cx('caption', 'muted', styles.cardNote)}>
                Signed in. The token is kept encrypted in this phone&apos;s keystore, never in the clear.
              </p>
              <Button variant="text" tone="danger" className={styles.cardAction} onClick={() => setSigningOut(true)}>
                Sign out
              </Button>
            </>
          )}
        </>
      ) : (
        <>
          <span className="body">GitHub</span>
          <p className={cx('caption', 'muted', styles.cardNote)}>
            Sign in to clone your repositories, push your commits and open pull requests.
          </p>
          <Button variant="filled" className={styles.cardAction} onClick={() => setSigningIn(true)}>
            Sign in with GitHub
          </Button>
        </>
      )}
      {signingIn && (
        <GitHubLoginDialog
          onClose={() => setSigningIn(false)}
          onSignedIn={(signedIn) => {
            setSigningIn(false);
            showSnackbar(`Signed in as @${signedIn.login}`);
          }}
        />
      )}
      {signingOut && account && (
        <Dialog
          title="Sign out of GitHub"
          eyebrow={`@${account.login}`}
          onClose={() => setSigningOut(false)}
          actions={
            <>
              <Button variant="text" onClick={() => setSigningOut(false)}>
                Cancel
              </Button>
              <Button variant="filled" tone="danger" onClick={signOut}>
                Sign out
              </Button>
            </>
          }
        >
          <p className="body">
            Pepino forgets the token. Your repositories stay on the phone; to clone, push or open pull requests you sign
            in again. To revoke Pepino&apos;s access altogether: GitHub → Settings → Applications.
          </p>
        </Dialog>
      )}
    </section>
  );
}

/** The GitHub picture, or the login's first letter (offline, or none). */
function Avatar({ account }: { account: GitHubAccount }) {
  const [failed, setFailed] = useState(false);
  if (!account.avatarUrl || failed) {
    return (
      <span className={cx(styles.avatar, styles.avatarLetter)} aria-hidden>
        {account.login.charAt(0).toUpperCase()}
      </span>
    );
  }
  return <img className={styles.avatar} src={account.avatarUrl} alt="" onError={() => setFailed(true)} />;
}
