import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { useEffect, useState } from 'react';
import { errorMessage } from '../features/projects/errors';
import { FileExplorer } from '../features/projects/FileExplorer';
import { dispatchBack, useBackHandler } from '../ui/back';
import { Button, Divider, RedBar } from '../ui/components';
import { cx } from '../ui/cx';
import { useSnackbar } from '../ui/useSnackbar';
import styles from './App.module.css';
import { CommandPalette } from './CommandPalette';
import { type AppDestination, DESTINATIONS, HOME } from './destinations';
import { useServices } from './services';

type SpaceState = 'creating' | 'ready' | 'error';

export function App() {
  const { registry, dispatcher, events, projectSpace } = useServices();
  const showSnackbar = useSnackbar();
  const [destination, setDestination] = useState<AppDestination>(HOME);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [space, setSpace] = useState<SpaceState>('creating');

  useEffect(() => {
    let active = true;
    projectSpace.ensureCreated().then(
      () => active && setSpace('ready'),
      (error: unknown) => {
        console.error(error);
        if (active) setSpace('error');
      },
    );
    return () => {
      active = false;
    };
  }, [projectSpace]);

  useEffect(() => {
    let count = 0;
    const disposers = [
      registry.register({
        id: 'demo.hello',
        title: 'Say hello',
        run: () => showSnackbar('Hello from Pepino 🥒'),
      }),
      registry.register({
        id: 'demo.count',
        title: 'Increment counter',
        run: () => {
          count += 1;
          events.publish('demo.counterChanged', { count });
        },
      }),
      events.subscribe('demo.counterChanged', ({ count }) => showSnackbar(`Counter is now ${count}`)),
    ];
    return () => disposers.forEach((dispose) => dispose());
  }, [registry, events, showSnackbar]);

  // Back: innermost handler first (dialogs, explorer UP), then home tab, then leave the app.
  useBackHandler(destination !== HOME, () => setDestination(HOME));
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listener = CapacitorApp.addListener('backButton', () => {
      if (!dispatchBack()) void CapacitorApp.exitApp();
    });
    return () => {
      void listener.then((handle) => handle.remove());
    };
  }, []);

  const runCommand = (id: string) => {
    setPaletteOpen(false);
    dispatcher.execute(id).catch((error: unknown) => showSnackbar(`Error: ${errorMessage(error)}`));
  };

  return (
    <div className={styles.app}>
      <RedBar />
      <header className={styles.header}>
        <h1 className="headline">PEPINO</h1>
        <span className="label accent">MOBILE IDE</span>
      </header>
      <Divider />
      <main className={styles.content}>
        {destination === 'projects' ? (
          <ProjectsScreen state={space} />
        ) : (
          <ComingSoon label={DESTINATIONS.find((d) => d.id === destination)!.label} />
        )}
        <Button variant="filled" className={styles.fab} onClick={() => setPaletteOpen(true)}>
          Commands
        </Button>
      </main>
      <nav className={styles.nav}>
        {DESTINATIONS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={cx('label', styles.navItem)}
            aria-current={id === destination ? 'page' : undefined}
            onClick={() => setDestination(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} onRun={runCommand} />}
    </div>
  );
}

function ProjectsScreen({ state }: { state: SpaceState }) {
  const { projectSpace } = useServices();
  if (state === 'ready') return <FileExplorer projectSpace={projectSpace} />;
  return (
    <p className={cx('label', styles.status, state === 'error' ? 'accent' : 'muted')}>
      {state === 'creating' ? 'CREATING PROJECT SPACE…' : '● PROJECT SPACE ERROR'}
    </p>
  );
}

function ComingSoon({ label }: { label: string }) {
  return (
    <div className={styles.comingSoon}>
      <span className="headline">{label}</span>
      <span className="label accent">COMING SOON</span>
    </div>
  );
}
