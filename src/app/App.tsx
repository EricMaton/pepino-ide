import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { folderLabelFor } from '../features/editor/labels';
import { errorMessage } from '../features/projects/errors';
import { FileExplorer } from '../features/projects/FileExplorer';
import { ProjectBar } from '../features/projects/ProjectBar';
import { RecentProjects } from '../features/projects/RecentProjects';
import { type ProjectInfo, readProject } from '../features/projects/projects';
import { dispatchBack, useBackHandler } from '../ui/back';
import { Button } from '../ui/components';
import { cx } from '../ui/cx';
import { BranchIcon, FolderIcon, PromptIcon, SlidersIcon } from '../ui/icons';
import { PepinoMark } from '../ui/Logo';
import { useKeyboardVisible } from '../ui/keyboard';
import { useSnackbar } from '../ui/useSnackbar';
import styles from './App.module.css';
import { CommandPalette } from './CommandPalette';
import { type AppDestination, DESTINATIONS, HOME } from './destinations';
import { useServices } from './services';

type SpaceState = 'creating' | 'ready' | 'error';

// The editor and its grammars load on first use, keeping them out of the start-up bundle.
const EditorScreen = lazy(() => import('../features/editor/EditorScreen'));

interface OpenFile {
  path: string;
  folderLabel: string;
}

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
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [openFile, setOpenFile] = useState<OpenFile | null>(null);
  const keyboardOpen = useKeyboardVisible();
  // Typing in the editor gets the whole screen: header and bottom nav step aside.
  const focusMode = keyboardOpen && openFile !== null && destination === 'projects';

  const openProject = useCallback(
    (path: string) => {
      readProject(projectSpace, path)
        .then((info) => {
          if (!info) throw new Error(`Not a project: ${path}`);
          setProject(info);
          events.publish('project.opened', info);
        })
        .catch((error: unknown) => showSnackbar(`Error: ${errorMessage(error)}`));
    },
    [projectSpace, events, showSnackbar],
  );

  const closeProject = useCallback(() => {
    if (!project) return;
    setProject(null);
    events.publish('project.closed', project);
  }, [events, project]);

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

  useEffect(() => {
    // While a file is open the editor owns closing (it may have unsaved changes).
    if (!project || openFile) return;
    return registry.register({ id: 'project.close', title: `Close project ${project.name}`, run: closeProject });
  }, [registry, project, openFile, closeProject]);

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
    <div className={styles.app} data-focus-mode={focusMode || undefined}>
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
        {current.teaser ? (
          <ComingSoon label={current.label} {...current.teaser} />
        ) : (
          <ProjectsScreen
            state={space}
            project={project}
            onOpenProject={openProject}
            onCloseProject={closeProject}
            onOpenFile={(path, rootPath, rootName) =>
              setOpenFile({ path, folderLabel: folderLabelFor(path, rootPath, rootName) })
            }
          />
        )}
        {openFile && (
          <Suspense fallback={null}>
            <EditorScreen
              key={openFile.path}
              path={openFile.path}
              folderLabel={openFile.folderLabel}
              visible={destination === 'projects'}
              onClose={() => setOpenFile(null)}
            />
          </Suspense>
        )}
        {!(openFile && destination === 'projects') && (
          <Button variant="filled" className={styles.fab} onClick={() => setPaletteOpen(true)}>
            <PromptIcon size={20} />
            Commands
          </Button>
        )}
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

interface ProjectsScreenProps {
  state: SpaceState;
  project: ProjectInfo | null;
  onOpenProject: (path: string) => void;
  onCloseProject: () => void;
  onOpenFile: (path: string, rootPath: string, rootName: string) => void;
}

function ProjectsScreen({ state, project, onOpenProject, onCloseProject, onOpenFile }: ProjectsScreenProps) {
  const { projectSpace, recentProjects } = useServices();
  if (state === 'ready' && project) {
    return (
      <>
        <ProjectBar project={project} onClose={onCloseProject} />
        <FileExplorer
          key={project.path}
          projectSpace={projectSpace}
          rootPath={project.path}
          rootLabel={project.name}
          rootName={project.name}
          onExitRoot={onCloseProject}
          onOpenFile={(path) => onOpenFile(path, project.path, project.name)}
        />
      </>
    );
  }
  if (state === 'ready') {
    return (
      <FileExplorer
        key="space"
        projectSpace={projectSpace}
        rootPath=""
        rootLabel={
          <>
            <span className="muted">~/</span>projects
          </>
        }
        rootName="~/projects"
        onOpenProject={onOpenProject}
        onOpenFile={(path) => onOpenFile(path, '', '~/projects')}
        rootHeader={<RecentProjects store={recentProjects} onOpen={onOpenProject} />}
      />
    );
  }
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
