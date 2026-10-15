import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { useEffect, useState } from 'react';
import { errorMessage } from '../features/projects/errors';
import { FileExplorer } from '../features/projects/FileExplorer';
import { dispatchBack, useBackHandler } from '../ui/back';
import { Button } from '../ui/components';
import { cx } from '../ui/cx';
import { BranchIcon, FolderIcon, PromptIcon, SlidersIcon } from '../ui/icons';
import { PepinoMark } from '../ui/Logo';
import { useSnackbar } from '../ui/useSnackbar';
import styles from './App.module.css';
import { CommandPalette } from './CommandPalette';
import { type AppDestination, DESTINATIONS, HOME } from './destinations';
import { useServices } from './services';

type SpaceState = 'creating' | 'ready' | 'error';

const NAV_ICONS: Record<AppDestination, typeof FolderIcon> = {
  projects: FolderIcon,
  git: BranchIcon,
  settings: SlidersIcon,
};

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

  const current = DESTINATIONS.find((d) => d.id === destination)!;

  const runCommand = (id: string) => {
    setPaletteOpen(false);
    dispatcher.execute(id).catch((error: unknown) => showSnackbar(`Error: ${errorMessage(error)}`));
  };

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <PepinoMark size={44} />
        <div className={styles.brand}>
          <h1 className="display">Pepino</h1>
          <span className="label">
            <span className="accent">//</span> Mobile IDE
          </span>
        </div>
        <span className={cx('caption', 'muted', styles.version)}>v{__APP_VERSION__}</span>
      </header>
      <main className={styles.content}>
        {current.teaser ? <ComingSoon label={current.label} {...current.teaser} /> : <ProjectsScreen state={space} />}
        <Button variant="filled" className={styles.fab} onClick={() => setPaletteOpen(true)}>
          <PromptIcon size={20} />
          Commands
        </Button>
      </main>
      <nav className={styles.nav}>
        {DESTINATIONS.map(({ id, label }) => {
          const NavIcon = NAV_ICONS[id];
          return (
            <button
              key={id}
              type="button"
              className={styles.navItem}
              aria-current={id === destination ? 'page' : undefined}
              onClick={() => setDestination(id)}
            >
              <NavIcon size={22} />
              <span className="label">{label}</span>
            </button>
          );
        })}
      </nav>
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} onRun={runCommand} />}
    </div>
  );
}

function ProjectsScreen({ state }: { state: SpaceState }) {
  const { projectSpace } = useServices();
  if (state === 'ready') return <FileExplorer projectSpace={projectSpace} />;
  if (state === 'creating') return <p className={cx('label', 'cursor', styles.status)}>Mounting project space</p>;
  return (
    <p className={cx('label', styles.status, styles.statusError)}>✕ Project space error — storage is not writable</p>
  );
}

function ComingSoon({ label, sprint, description }: { label: string; sprint: string; description: string }) {
  return (
    <div className={styles.comingSoon}>
      <div className={styles.tape} aria-hidden />
      <div className={styles.comingBody}>
        <span className="label accent">// {sprint}</span>
        <h2 className={cx('display', styles.outlineText)}>{label}</h2>
        <p className="body muted">{description}</p>
        <span className="label cursor">Under construction</span>
      </div>
      <div className={styles.tape} aria-hidden />
    </div>
  );
}
