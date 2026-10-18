import { App as CapacitorApp } from '@capacitor/app';

/*
 * Signing in to an AI account (#190), for the many who would not know how
 * to make an API key: the browser opens the provider's sign-in, which comes
 * back to Pepino (pepino://auth/<provider>?code=…) through a small public
 * page; the native side exchanges the code for the user's own key and keeps
 * it (secrets.ts). PKCE: only who started the sign-in can exchange its code.
 */

/** The providers a plugin's secret can be signed in to. */
export const SIGN_IN_PROVIDERS = ['openrouter'] as const;
export type SignInProvider = (typeof SIGN_IN_PROVIDERS)[number];

/** The public page the provider comes back to; it hands the code to the app. */
export const CALLBACK_URL = 'https://ericmaton.github.io/pepino-plugins/auth/openrouter.html';

export const OPENROUTER = {
  host: 'openrouter.ai',
  authorize: (challenge: string) =>
    `https://openrouter.ai/auth?${new URLSearchParams({
      callback_url: CALLBACK_URL,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })}`,
  exchange: 'https://openrouter.ai/api/v1/auth/keys',
  /** The exchange's body, and the field of its answer that is the key. */
  body: (code: string, verifier: string) =>
    JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
  field: 'key',
};

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/** A PKCE pair: the verifier kept here, the challenge sent with the sign-in. */
export async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

/** The code in a link back to the app from [provider]'s sign-in, or null. */
export function codeFrom(url: string, provider: SignInProvider): string | null {
  const match = /^pepino:\/\/auth\/([a-z]+)\?(.*)$/.exec(url);
  if (!match || match[1] !== provider) return null;
  return new URLSearchParams(match[2]).get('code');
}

/** The next code [provider]'s sign-in sends back to the app; aborted with [signal]. */
export function waitForCode(provider: SignInProvider, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    let remove = () => undefined as void;
    const done = () => {
      remove();
      signal.removeEventListener('abort', aborted);
    };
    const aborted = () => {
      done();
      reject(new Error('Cancelled'));
    };
    signal.addEventListener('abort', aborted);
    void CapacitorApp.addListener('appUrlOpen', ({ url }) => {
      const code = codeFrom(url, provider);
      if (code === null) return;
      done();
      resolve(code);
    }).then((handle) => {
      remove = () => void handle.remove();
      if (signal.aborted) remove();
    });
  });
}
