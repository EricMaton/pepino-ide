import { useEffect, useRef, useState } from 'react';
import { type AppDestination, isPluginPage } from '../../app/destinations';
import { useServices } from '../../app/services';
import { TopBar } from '../../app/TopBar';
import { THEME_EVENT } from '../../ui/theme';
import type { PluginPage } from './manager';
import { type FromPage, pageDocument, themeTokens, type ToPage } from './pageDocument';
import styles from './PluginPages.module.css';

/** The most a page and its plugin may send each other at once, as JSON. */
const MESSAGE_LIMIT = 1024 * 1024;
/** Messages for a page still loading wait, up to this many. */
const QUEUE_LIMIT = 100;

/** `plugin:<plugin id>.<page id>` taken apart (a plugin id has dots, a page id none). */
function pageOf(destination: string): [pluginId: string, pageId: string] {
  const name = destination.slice('plugin:'.length);
  const dot = name.lastIndexOf('.');
  return [name.slice(0, dot), name.slice(dot + 1)];
}

/** [data] as plain JSON within the limit, or undefined. */
function plain(data: unknown): unknown {
  try {
    const json = JSON.stringify(data ?? null);
    return json.length <= MESSAGE_LIMIT ? JSON.parse(json) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The plugins' pages (#185): each one mounted the first time it is opened
 * and kept while its plugin runs (so it keeps its state), shown when it is
 * the [current] destination. Carries the messages between each page and its
 * plugin, and the app's theme to every page as it changes.
 */
export function PluginPages({ pages, current }: { pages: readonly PluginPage[]; current: AppDestination }) {
  const { pluginHost } = useServices();
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const loaded = useRef(new Set<string>());
  const queued = useRef(new Map<string, ToPage[]>());
  const [opened, setOpened] = useState<readonly string[]>([]);
  if (isPluginPage(current) && !opened.includes(current) && pages.some((page) => page.destination === current)) {
    setOpened([...opened, current]);
  }

  useEffect(() => {
    pluginHost.setPageSink((pluginId, pageId, data) => {
      const destination = `plugin:${pluginId}.${pageId}`;
      const message: ToPage = { pepino: 'message', data: plain(data) };
      const frame = frames.current.get(destination);
      if (frame?.contentWindow && loaded.current.has(destination)) {
        frame.contentWindow.postMessage(message, '*');
      } else {
        const waiting = queued.current.get(destination) ?? [];
        if (waiting.length < QUEUE_LIMIT) queued.current.set(destination, [...waiting, message]);
      }
    });
    const fromPage = (event: MessageEvent) => {
      for (const [destination, frame] of frames.current) {
        if (event.source !== frame.contentWindow) continue;
        const message = event.data as FromPage | null;
        if (message?.pepino !== 'page') return;
        const data = plain(message.data);
        if (data !== undefined) void pluginHost.fromPage(...pageOf(destination), data);
        return;
      }
    };
    const toTheme = () => {
      const message: ToPage = { pepino: 'theme', tokens: themeTokens() };
      frames.current.forEach((frame) => frame.contentWindow?.postMessage(message, '*'));
    };
    window.addEventListener('message', fromPage);
    window.addEventListener(THEME_EVENT, toTheme);
    return () => {
      pluginHost.setPageSink(() => undefined);
      window.removeEventListener('message', fromPage);
      window.removeEventListener(THEME_EVENT, toTheme);
    };
  }, [pluginHost]);

  return (
    <>
      {pages
        .filter((page) => opened.includes(page.destination))
        .map((page) => (
          <PageFrame
            key={`${page.destination}:${page.html.length}`}
            page={page}
            visible={current === page.destination}
            onFrame={(frame) => {
              // Called again on every render (with null, then the frame): only another frame starts over
              if (!frame || frames.current.get(page.destination) === frame) return;
              frames.current.set(page.destination, frame);
              loaded.current.delete(page.destination);
            }}
            onLoad={() => {
              loaded.current.add(page.destination);
              const frame = frames.current.get(page.destination);
              for (const message of queued.current.get(page.destination) ?? []) {
                frame?.contentWindow?.postMessage(message, '*');
              }
              queued.current.delete(page.destination);
            }}
          />
        ))}
    </>
  );
}

/** One page: its document from a blob: URL, in a frame that may run scripts and nothing else. */
function PageFrame({
  page,
  visible,
  onFrame,
  onLoad,
}: {
  page: PluginPage;
  visible: boolean;
  onFrame: (frame: HTMLIFrameElement | null) => void;
  onLoad: () => void;
}) {
  // Revoked once loaded: the frame keeps its document, nothing else can open it
  const [url] = useState(() =>
    URL.createObjectURL(new Blob([pageDocument(page.html, themeTokens())], { type: 'text/html' })),
  );

  return (
    <section className={styles.page} hidden={!visible} aria-label={page.title}>
      {visible && (
        <TopBar
          title={page.title}
          subtitle={`${page.plugin.toUpperCase()} · PLUGIN`}
          label={`Search commands · ${page.title}`}
        />
      )}
      <iframe
        ref={onFrame}
        className={styles.frame}
        src={url}
        sandbox="allow-scripts"
        title={page.title}
        onLoad={() => {
          URL.revokeObjectURL(url);
          onLoad();
        }}
      />
    </section>
  );
}
