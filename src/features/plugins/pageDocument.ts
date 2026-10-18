/*
 * A plugin's page as it is shown (#185): its HTML in a document that Pepino
 * writes the start of, so what Pepino puts there comes before anything of
 * the plugin's. That start is a Content-Security-Policy allowing no network
 * (scripts and styles only inline, images and fonts only as data), the
 * app's theme as CSS variables, base styles, and `pepino`, the page's way
 * to talk to its plugin. The frame it goes in is sandboxed (allow-scripts
 * only), and the app's own CSP only lets frames load blob: documents.
 */

/** No network for a plugin's page: everything it has is inline, or comes as messages. */
export const PAGE_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";

/** The theme tokens a page gets as CSS variables, kept in step with the app's theme. */
export const PAGE_TOKENS = [
  '--bg',
  '--fg',
  '--surface',
  '--surface-variant',
  '--primary',
  '--on-primary',
  '--error',
  '--outline',
  '--hairline',
  '--git-added',
  '--git-modified',
  '--git-removed',
  '--on-git',
  '--diff-added',
  '--diff-removed',
] as const;

/** Messages between the app and a page; the plugin's own data travels in `data`. */
export type ToPage = { pepino: 'message'; data: unknown } | { pepino: 'theme'; tokens: Record<string, string> };
export type FromPage = { pepino: 'page'; data: unknown };

/** The page's side: `pepino.postMessage(data)`, `pepino.onMessage(fn)`; the theme applied as it changes. */
const BRIDGE = `(() => {
  const listeners = [];
  const root = document.documentElement;
  // A page reaches nothing but its plugin: no peer connections either
  for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel']) {
    try { Object.defineProperty(window, name, { value: undefined }); } catch (e) {}
  }
  Object.defineProperty(window, 'pepino', {
    value: Object.freeze({
      postMessage(data) { parent.postMessage({ pepino: 'page', data: data === undefined ? null : data }, '*'); },
      onMessage(listener) {
        if (typeof listener !== 'function') throw new TypeError('pepino.onMessage: give a function');
        listeners.push(listener);
      },
    }),
  });
  addEventListener('message', (event) => {
    if (event.source !== parent || !event.data) return;
    const message = event.data;
    if (message.pepino === 'theme') {
      for (const [name, value] of Object.entries(message.tokens)) root.style.setProperty(name, value);
    } else if (message.pepino === 'message') {
      for (const listener of listeners) {
        try { listener(message.data); } catch (error) { console.error(error); }
      }
    }
  });
})();`;

const BASE_STYLE = `html, body { margin: 0; background: var(--bg); color: var(--fg); }
body { font: 14px/1.5 ui-monospace, 'JetBrains Mono', monospace; -webkit-tap-highlight-color: transparent; }`;

const escapeAttribute = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** The start of a page's document: what Pepino puts before the plugin's head. */
export function pageHead(tokens: Record<string, string>): string {
  const variables = Object.entries(tokens)
    .filter(([name]) => (PAGE_TOKENS as readonly string[]).includes(name))
    .map(([name, value]) => `${name}: ${value.replace(/[;{}<>]/g, '')};`)
    .join(' ');
  return [
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(PAGE_CSP)}">`,
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<style>:root { ${variables} }\n${BASE_STYLE}</style>`,
    `<script>${BRIDGE}</script>`,
  ].join('\n');
}

/**
 * [html] (a plugin's page) as a whole document with Pepino's start first.
 * It is parsed, never run, to take its head and body apart: whatever the
 * plugin wrote, even before its <head>, ends up after the CSP.
 */
export function pageDocument(html: string, tokens: Record<string, string>): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const bodyAttributes = [...parsed.body.attributes]
    .map((attribute) => `${attribute.name}="${escapeAttribute(attribute.value)}"`)
    .join(' ');
  return `<!doctype html>\n<html><head>\n${pageHead(tokens)}\n${parsed.head.innerHTML}\n</head><body ${bodyAttributes}>${parsed.body.innerHTML}</body></html>`;
}

/** The app's theme now, as a page's CSS variables. */
export function themeTokens(root: HTMLElement = document.documentElement): Record<string, string> {
  const style = getComputedStyle(root);
  return Object.fromEntries(PAGE_TOKENS.map((name) => [name, style.getPropertyValue(name).trim()]));
}
