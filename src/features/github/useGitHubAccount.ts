import { useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import type { GitHubAccount } from './github';

/** The GitHub account, kept up to date with sign-ins and sign-outs. Undefined while reading. */
export function useGitHubAccount(): GitHubAccount | null | undefined {
  const { github } = useServices();
  const [account, setAccount] = useState<GitHubAccount | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    github.account().then(
      (found) => active && setAccount(found),
      () => active && setAccount(null),
    );
    const unsubscribe = github.subscribe(setAccount);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [github]);
  return account;
}
