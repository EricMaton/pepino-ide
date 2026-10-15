import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
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
import { restoreSession } from './restoreSession';
import { type EditorViewState, withEditorState } from './session';
import { type AppDestination, DESTINATIONS, HOME } from './destinations';
import { useServices } from './services';

type SpaceState = 'creating' | 'ready' | 'error';

// The editor and its grammars load on first use, keeping them out of the start-up bundle.
const EditorScreen = lazy(() => import('../features/editor/EditorScreen'));

interface OpenFile {
  path: string;
  folderLabel: string;
  /** Cursor and scroll to reopen at. */
  viewState?: EditorViewState;
}

const NAV_ICONS: Record<AppDestination, typeof FolderIcon> = {
  projects: FolderIcon,
  git: BranchIcon,
  settings: SlidersIcon,
};

export function App() {
  const { registry, dispatcher, events, projectSpace, session } = useServices();
  const showSnackbar = useSnackbar();
  const [destination, setDestination] = useState<AppDestination>(HOME);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [space, setSpace] = useState<SpaceState>('creating');
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [openFile, setOpenFile] = useState<OpenFile | null>(null);
  const keyboardOpen = useKeyboardVisible();
  // Typing in the editor gets the whole screen: header and bottom nav step aside.
  const focusMode = keyboardOpen && openFile !== null && destination === 'projects';
  // Session (#19): restored once the space is ready, then kept up to date.
  const [restored, setRestored] = useState(false);
  const [initialStacks, setInitialStacks] = useState<Record<string, string[]>>({});
  // Updated on every cursor move/scroll, so a ref: only read in event handlers, never while rendering.
  const editorStates = useRef<Record<string, EditorViewState>>({});

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
    if (space !== 'ready') return;
    let active = true;
    session
      .load()
      .then((saved) => restoreSession(projectSpace, saved))
      .then((last) => {
        if (!active) return;
        editorStates.current = last.editors;
        const root = last.project?.path ?? '';
        if (last.stack) setInitialStacks({ [root]: last.stack });
        if (last.project) {
          setProject(last.project);
          events.publish('project.opened', last.project);
        }
        if (last.openFile) {
          setOpenFile({
            path: last.openFile,
            folderLabel: folderLabelFor(last.openFile, root, last.project?.name ?? '~/projects'),
            viewState: last.editors[last.openFile],
          });
        }
      })
      .catch((error: unknown) => console.error('Cannot restore the session', error))
      .finally(() => {
        if (active) setRestored(true);
      });
    return () => {
      active = false;
    };
  }, [space, session, projectSpace, events]);

  // Persist only after restoring, or the empty start-up state would overwrite the saved one.
  useEffect(() => {
    if (!restored) return;
    void session.update((saved) => ({ ...saved, project: project?.path ?? null }));
  }, [restored, session, project]);

  useEffect(() => {
    if (!restored) return;
    void session.update((saved) => ({ ...saved, openFile: openFile?.path ?? null }));
  }, [restored, session, openFile]);

  const rememberStack = useCallback(
    (root: string, stack: string[]) => {
      if (!restored) return;
      setInitialStacks((stacks) => ({ ...stacks, [root]: stack }));
      void session.update((saved) => ({ ...saved, explorer: { ...saved.explorer, [root]: stack } }));
    },
    [restored, session],
  );

  const rememberViewState = useCallback(
    (path: string, state: EditorViewState) => {
      editorStates.current = { ...editorStates.current, [path]: state };
      void session.update((saved) => withEditorState(saved, path, state, Date.now()));
    },
    [session],
  );

  // Lets screens that hide the COMMANDS button (the editor) open the palette.
  useEffect(
    () =>
      registry.register({
        id: 'app.openPalette',
        title: 'Command palette',
        hidden: true,
        run: () => setPaletteOpen(true),
      }),
    [registry],
  );

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
            state={space === 'ready' && !restored ? 'creating' : space}
            initialStacks={initialStacks}
            onStackChange={rememberStack}
            project={project}
            onOpenProject={openProject}
            onCloseProject={closeProject}
            onOpenFile={(path, rootPath, rootName) =>
              setOpenFile({
                path,
                folderLabel: folderLabelFor(path, rootPath, rootName),
                viewState: editorStates.current[path],
              })
            }
          />
        )}
        {openFile && (
          <Suspense fallback={null}>
            <EditorScreen
              key={openFile.path}
              path={openFile.path}
              folderLabel={openFile.folderLabel}
              initialViewState={openFile.viewState}
              onViewState={(state) => rememberViewState(openFile.path, state)}
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
  initialStacks: Record<string, string[]>;
  onStackChange: (root: string, stack: string[]) => void;
}

function ProjectsScreen({
  state,
  project,
  onOpenProject,
  onCloseProject,
  onOpenFile,
  initialStacks,
  onStackChange,
}: ProjectsScreenProps) {
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
          initialStack={initialStacks[project.path]}
          onStackChange={(stack) => onStackChange(project.path, stack)}
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
        initialStack={initialStacks['']}
        onStackChange={(stack) => onStackChange('', stack)}
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
