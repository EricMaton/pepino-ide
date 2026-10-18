import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { folderLabelFor } from '../features/editor/labels';
import { GitScreen } from '../features/git/GitScreen';
import { PluginRuntime } from '../features/plugins/PluginRuntime';
import { PluginPages } from '../features/plugins/PluginPages';
import { usePluginPages } from '../features/plugins/usePluginPages';
import { PluginsScreen } from '../features/settings/PluginsScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { errorMessage } from '../features/projects/errors';
import { FileExplorer } from '../features/projects/FileExplorer';
import { basename, isWithin } from '../features/projects/paths';
import { type ProjectInfo, readProject } from '../features/projects/projects';
import { RecentProjects } from '../features/projects/RecentProjects';
import { useRecentProjects } from '../features/projects/useRecentProjects';
import { useWorkspaceState } from '../features/workspace/useWorkspace';
import { NoFileOpen } from '../features/workspace/WorkspaceDrawer';
import { dispatchBack, useBackHandler } from '../ui/back';
import { cx } from '../ui/cx';
import { Button } from '../ui/components';
import { CloseIcon, ProjectIcon } from '../ui/icons';
import { useKeyboardVisible } from '../ui/keyboard';
import { navigate } from '../ui/motion';
import { useSnackbar } from '../ui/useSnackbar';
import styles from './App.module.css';
import { restoreSession } from './restoreSession';
import { type EditorViewState, withEditorState } from './session';
import { type AppDestination, DESTINATIONS, HOME, isPluginPage } from './destinations';
import { useServices } from './services';
import { NavBar } from './NavBar';
import { TopBar, TopBarFrame } from './TopBar';
import { type TopBarSlots, TopBarSlotsContext } from './topBarSlots';
import { useFileSource } from './useFileSource';

type SpaceState = 'creating' | 'ready' | 'error';

// The editor and its grammars load on first use, keeping them out of the start-up bundle.
const EditorScreen = lazy(() => import('../features/editor/EditorScreen'));
// xterm.js loads with the first visit to TERMINAL (#39)
const TerminalScreen = lazy(() => import('../features/terminal/TerminalScreen'));

interface OpenFile {
  /** One per editing session: a rename changes [path] but keeps the same editor. */
  id: number;
  path: string;
  folderLabel: string;
  /** Cursor and scroll to reopen at. */
  viewState?: EditorViewState;
}

const SPACE_NAME = '~/projects';

/*
 * PROJECTS has two modes, kept apart on purpose:
 * - the explorer browses ~/projects: tapping a folder goes into it, and a
 *   folder is opened as the workspace with its own button; a file opens on
 *   its own (a "loose" file), outside any workspace;
 * - the workspace is the active project: its tree, and its open files as tabs.
 * The active project stays active while the explorer shows; git, the
 * terminal and the editor work on it.
 */
export function App() {
  const { registry, events, projectSpace, session, workspace, terminal } = useServices();
  const showSnackbar = useSnackbar();
  const [chosen, setDestination] = useState<AppDestination>(HOME);
  const pluginPages = usePluginPages();
  // A plugin's page whose plugin went (off, uninstalled) leaves for home
  const destination: AppDestination =
    isPluginPage(chosen) && !pluginPages.some((page) => page.destination === chosen) ? HOME : chosen;
  // TERMINAL stays mounted from its first visit, hidden while other tabs show: its scrollback stays (#39)
  const [terminalOpened, setTerminalOpened] = useState(false);
  if (destination === 'terminal' && !terminalOpened) setTerminalOpened(true);
  const [space, setSpace] = useState<SpaceState>('creating');
  const [project, setProject] = useState<ProjectInfo | null>(null);
  // PROJECTS shows the active project's workspace, or the explorer.
  const [showProject, setShowProject] = useState(false);
  // Reached the explorer from the workspace with PROJECTS: the system back returns to the workspace.
  const [homeReturn, setHomeReturn] = useState(false);
  // The workspace's active tab; the only tab with an editor.
  const [openFile, setOpenFile] = useState<OpenFile | null>(null);
  // A file opened from the explorer, on its own.
  const [looseFile, setLooseFile] = useState<OpenFile | null>(null);
  const { openFiles: tabs } = useWorkspaceState(workspace);
  const keyboardOpen = useKeyboardVisible();
  const inWorkspace = destination === 'projects' && showProject && project !== null;
  const inExplorer = destination === 'projects' && !showProject;
  // Session (#19): restored once the space is ready, then kept up to date.
  const [restored, setRestored] = useState(false);
  const [initialStacks, setInitialStacks] = useState<Record<string, string[]>>({});
  // Updated on every cursor move/scroll, so a ref: only read in event handlers, never while rendering.
  const editorStates = useRef<Record<string, EditorViewState>>({});
  const editorSessions = useRef(0);
  const openFileRef = useRef(openFile);
  const looseFileRef = useRef(looseFile);
  const projectRef = useRef(project);
  useEffect(() => {
    openFileRef.current = openFile;
    looseFileRef.current = looseFile;
    projectRef.current = project;
  });
  /** A new editing session for [path], reopening at its last cursor and scroll. */
  const editorFor = useCallback(
    (path: string, root: string, rootName: string): OpenFile => ({
      id: ++editorSessions.current,
      path,
      folderLabel: folderLabelFor(path, root, rootName),
      viewState: editorStates.current[path],
    }),
    [],
  );
  /** The editor for the workspace's active tab, keeping the current one when it already shows it. */
  const syncEditor = useCallback(() => {
    const active = workspace.getState().activeFile;
    const current = projectRef.current;
    setOpenFile((open) =>
      open?.path === active ? open : active && current ? editorFor(active, current.path, current.name) : null,
    );
  }, [workspace, editorFor]);

  /** Makes [path] the active project and shows its workspace. Another project's tabs close (saving first). */
  const openProject = useCallback(
    (path: string) => {
      readProject(projectSpace, path)
        .then((info) => {
          if (!info) throw new Error(`Not a folder: ${path || SPACE_NAME}`);
          // The workspace rises out of where it was opened.
          navigate('rise', () => {
            if (info.path !== projectRef.current?.path) {
              setOpenFile(null);
              setProject(info);
            }
            setShowProject(true);
            setHomeReturn(false);
          });
          events.publish('project.opened', info);
        })
        .catch((error: unknown) => showSnackbar(`Error: ${errorMessage(error)}`));
    },
    [projectSpace, events, showSnackbar],
  );

  const closeProject = useCallback(() => {
    const current = projectRef.current;
    if (!current) return;
    setProject(null);
    setOpenFile(null);
    setShowProject(false);
    setHomeReturn(false);
    events.publish('project.closed', current);
  }, [events]);

  const openLoose = useCallback(
    (path: string) => navigate('forward', () => setLooseFile(editorFor(path, '', SPACE_NAME))),
    [editorFor],
  );
  const closeLoose = useCallback(() => navigate('back', () => setLooseFile(null)), []);

  /** Shows [path] as the workspace's active tab, sliding in from the side its tab is on. */
  const activate = useCallback(
    (path: string) => {
      const current = projectRef.current;
      if (!current || !isWithin(path, current.path)) {
        showSnackbar(`Error: Outside the workspace: ${path}`);
        return;
      }
      if (path === workspace.getState().activeFile && openFileRef.current) return;
      const change = () => {
        workspace.setActiveFile(path);
        syncEditor();
      };
      // From the tree a file opens "into" the workspace; between tabs the switch is instant.
      if (openFileRef.current) change();
      else navigate('forward', change);
    },
    [workspace, syncEditor, showSnackbar],
  );

  /** The editor closed its file (saved): its tab goes, and the neighbouring tab (or the tree) shows. */
  const closeActiveTab = useCallback(() => {
    const current = openFileRef.current;
    const change = () => {
      if (current) workspace.closeFile(current.path);
      syncEditor();
    };
    // The neighbouring tab just shows; closing the last one goes back out to the tree.
    if (workspace.getState().openFiles.length <= 1) navigate('back', change);
    else change();
  }, [workspace, syncEditor]);

  /** PROJECTS tapped again: the explorer. The active project stays active (and sinks into its strip). */
  const showExplorer = useCallback(() => {
    if (!showProject) return;
    const change = () => {
      setHomeReturn(project !== null);
      setShowProject(false);
    };
    if (project) navigate('sink', change);
    else change();
  }, [showProject, project]);
  /** Back into the active project's workspace, rising out of the explorer's strip. */
  const showWorkspace = useCallback(
    () =>
      navigate('rise', () => {
        setShowProject(true);
        setHomeReturn(false);
      }),
    [],
  );
  /** Out to the explorer; [alongside] changes the workspace in the same motion (the editor hiding its tree). */
  const leaveWorkspace = useCallback(
    (alongside?: () => void) =>
      navigate('sink', () => {
        alongside?.();
        setShowProject(false);
      }),
    [],
  );

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
        if (last.stack) setInitialStacks({ '': last.stack });
        if (last.project) {
          setProject(last.project);
          setShowProject(last.inWorkspace);
          events.publish('project.opened', last.project);
        }
        if (last.looseFile) openLoose(last.looseFile);
      })
      .catch((error: unknown) => console.error('Cannot restore the session', error))
      .finally(() => {
        if (active) setRestored(true);
      });
    return () => {
      active = false;
    };
  }, [space, session, projectSpace, events, openLoose]);

  // The workspace (#106) follows the active project; its saved tabs come back with it.
  useEffect(() => {
    let active = true;
    void workspace.setRoot(project?.path ?? '').then(() => {
      if (!active) return;
      // Open tabs always show one of them: the saved active one, else the first.
      const { activeFile, openFiles } = workspace.getState();
      if (project && !activeFile && openFiles.length > 0) workspace.setActiveFile(openFiles[0]);
      syncEditor();
    });
    return () => {
      active = false;
    };
  }, [workspace, project, syncEditor]);

  // The tree, the search, plugins and the agent ask for files through the workspace.
  useEffect(
    () =>
      events.subscribe('workspace.openRequested', ({ path }) => {
        if (!projectRef.current) {
          openLoose(path);
          return;
        }
        activate(path);
        setDestination('projects');
        setShowProject(true);
      }),
    [events, activate, openLoose],
  );

  // The active project follows renames and moves; deleting it leaves no active project.
  useEffect(() => {
    if (!project) return;
    const disposers = [
      events.subscribe('fs.moved', ({ from, to }) => {
        if (!isWithin(project.path, from)) return;
        readProject(projectSpace, to + project.path.slice(from.length))
          .then((info) => (info ? setProject(info) : closeProject()))
          .catch(() => closeProject());
      }),
      events.subscribe('fs.deleted', ({ path }) => {
        if (isWithin(project.path, path)) closeProject();
      }),
    ];
    return () => disposers.forEach((dispose) => dispose());
  }, [events, project, projectSpace, closeProject]);

  // Open files follow renames and moves; a deleted one closes (the workspace already dropped its tab).
  useEffect(() => {
    const disposers = [
      events.subscribe('fs.moved', ({ from, to }) => {
        const follow = (file: OpenFile | null, root: string, rootName: string) => {
          if (!file || !isWithin(file.path, from)) return file;
          const path = to + file.path.slice(from.length);
          return { ...file, path, folderLabel: folderLabelFor(path, root, rootName) };
        };
        const current = projectRef.current;
        if (current) {
          // The project itself may be what moved.
          const root = isWithin(current.path, from) ? to + current.path.slice(from.length) : current.path;
          setOpenFile((file) => follow(file, root, basename(root)));
        }
        setLooseFile((file) => follow(file, '', SPACE_NAME));
      }),
      events.subscribe('fs.deleted', ({ path }) => {
        const open = openFileRef.current;
        if (open && isWithin(open.path, path)) {
          syncEditor();
          showSnackbar(`${basename(open.path)} was deleted`);
        }
        const loose = looseFileRef.current;
        if (loose && isWithin(loose.path, path)) {
          setLooseFile(null);
          showSnackbar(`${basename(loose.path)} was deleted`);
        }
      }),
    ];
    return () => disposers.forEach((dispose) => dispose());
  }, [events, syncEditor, showSnackbar]);

  // Persist only after restoring, or the empty start-up state would overwrite the saved one.
  useEffect(() => {
    if (!restored) return;
    void session.update((saved) => ({ ...saved, project: project?.path ?? null, inWorkspace: showProject }));
  }, [restored, session, project, showProject]);

  useEffect(() => {
    if (!restored) return;
    void session.update((saved) => ({ ...saved, looseFile: looseFile?.path ?? null }));
  }, [restored, session, looseFile]);

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

  // Back: innermost handler first (dialogs; then up a level: a workspace file to its tree, the tree
  // out to the explorer, a loose file closing, the explorer going up), then these: the explorer
  // returns to the workspace PROJECTS left, other tabs return to PROJECTS; with nothing left the app closes.
  useBackHandler(destination !== HOME, () => setDestination(HOME));
  useBackHandler(inExplorer && homeReturn && project !== null && !looseFile, showWorkspace);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listener = CapacitorApp.addListener('backButton', () => {
      if (!dispatchBack()) void CapacitorApp.exitApp();
    });
    return () => {
      void listener.then((handle) => handle.remove());
    };
  }, []);

  const current = DESTINATIONS.find((d) => d.id === destination);

  // Screens portal their part of the top bar into these layers (see TopBar).
  const [slots, setSlots] = useState<TopBarSlots>({ screen: null, overlay: null });
  const onScreenSlot = useCallback(
    (screen: HTMLElement | null) =>
      setSlots((current) => (current.screen === screen ? current : { ...current, screen })),
    [],
  );
  const onOverlaySlot = useCallback(
    (overlay: HTMLElement | null) =>
      setSlots((current) => (current.overlay === overlay ? current : { ...current, overlay })),
    [],
  );

  const state = space === 'ready' && !restored ? 'creating' : space;
  // One editor per file: while the same file is open on its own, the workspace's editor steps aside (saving).
  const tabEditor = openFile && openFile.path !== looseFile?.path ? openFile : null;

  return (
    <TopBarSlotsContext value={slots}>
      <div className={styles.app} data-keyboard-open={keyboardOpen || undefined}>
        <PluginRuntime />
        <TopBarFrame onScreenSlot={onScreenSlot} onOverlaySlot={onOverlaySlot} />
        <main className={styles.content}>
          {destination === 'git' && state === 'ready' ? (
            <GitScreen project={project} onOpen={openProject} />
          ) : destination === 'terminal' ? null : destination === 'plugins' ? (
            <PluginsScreen subtitle={BRAND} />
          ) : destination === 'settings' ? (
            <SettingsScreen subtitle={BRAND} />
          ) : isPluginPage(destination) ? null : current?.teaser ? (
            <ComingSoon label={current.label} {...current.teaser} />
          ) : state === 'ready' && showProject && project ? (
            <WorkspaceScreen
              project={project}
              hasOpenFile={tabEditor !== null}
              onOpenFile={activate}
              onLeave={() => leaveWorkspace()}
            />
          ) : state === 'ready' ? (
            <ExplorerScreen
              activeProject={project}
              activeFile={openFile?.path ?? null}
              initialStack={initialStacks['']}
              onStackChange={(stack) => rememberStack('', stack)}
              onOpenFolder={openProject}
              onOpenFile={openLoose}
              onReturn={showWorkspace}
              onCloseProject={() => navigate('dismiss', closeProject)}
            />
          ) : (
            <SpaceStatus state={state} />
          )}
          <Suspense fallback={<span hidden data-loading />}>
            {terminalOpened && (
              <TerminalScreen project={state === 'ready' ? project : null} visible={destination === 'terminal'} />
            )}
            {tabEditor && (
              <EditorScreen
                key={tabEditor.id}
                path={tabEditor.path}
                folderLabel={tabEditor.folderLabel}
                initialViewState={tabEditor.viewState}
                onViewState={(state) => rememberViewState(tabEditor.path, state)}
                visible={inWorkspace}
                tabs={{
                  files: tabs,
                  onSelect: activate,
                  onClose: (path) => workspace.closeFile(path),
                  onLeave: leaveWorkspace,
                }}
                onClose={closeActiveTab}
              />
            )}
            {looseFile && (
              <EditorScreen
                key={looseFile.id}
                path={looseFile.path}
                folderLabel={looseFile.folderLabel}
                initialViewState={looseFile.viewState}
                onViewState={(state) => rememberViewState(looseFile.path, state)}
                visible={inExplorer}
                tabs={null}
                onClose={closeLoose}
              />
            )}
          </Suspense>
          <PluginPages pages={pluginPages} current={destination} />
        </main>
        <NavBar
          destination={destination}
          // TERMINAL only where there is one: Android (#161)
          available={[
            ...DESTINATIONS.map(({ id }) => id).filter((id) => id !== 'terminal' || terminal.available),
            ...pluginPages.map((page) => page.destination),
          ]}
          pages={pluginPages}
          // PROJECTS again, from inside PROJECTS, goes out to the explorer; any other tap only navigates.
          onSelect={(id) => (id === HOME && destination === HOME ? showExplorer() : setDestination(id))}
        />
      </div>
    </TopBarSlotsContext>
  );
}

const BRAND = `PEPINO · MOBILE IDE · v${__APP_VERSION__}`;

/** Top bar for screens outside a workspace: where you are. */
function HomeTopBar({ title, subtitle = BRAND }: { title: string; subtitle?: string }) {
  return <TopBar title={title} subtitle={subtitle} label={`Search commands · ${title}`} />;
}

interface ExplorerScreenProps {
  activeProject: ProjectInfo | null;
  /** The active project's active tab, named on the way back to it. */
  activeFile: string | null;
  initialStack?: string[];
  onStackChange: (stack: string[]) => void;
  onOpenFolder: (path: string) => void;
  onOpenFile: (path: string) => void;
  /** Back to the active project's workspace. */
  onReturn: () => void;
  /** Leaves no active project (its files are saved). */
  onCloseProject: () => void;
}

/** The explorer of ~/projects, with the recent projects on top and the way back to the active one at the bottom. */
function ExplorerScreen({
  activeProject,
  activeFile,
  initialStack,
  onStackChange,
  onOpenFolder,
  onOpenFile,
  onReturn,
  onCloseProject,
}: ExplorerScreenProps) {
  const { projectSpace, recentProjects } = useServices();
  const recents = useRecentProjects(recentProjects);
  const activePath = activeProject?.path ?? null;
  const workspaces = useMemo(() => new Set(recents?.recents.map((recent) => recent.path)), [recents]);
  return (
    <>
      <HomeTopBar title="Projects" />
      <FileExplorer
        projectSpace={projectSpace}
        rootPath=""
        rootLabel={SPACE_NAME}
        rootName={SPACE_NAME}
        onOpenFile={onOpenFile}
        onOpenFolder={onOpenFolder}
        activePath={activePath}
        workspaces={workspaces}
        rootHeader={<RecentProjects loaded={recents} activePath={activePath} onOpen={onOpenFolder} />}
        initialStack={initialStack}
        onStackChange={onStackChange}
      />
      {activeProject && (
        <div className={styles.returnStrip}>
          <button
            type="button"
            className={styles.returnMain}
            onClick={onReturn}
            aria-label={`Back to ${activeProject.name}`}
          >
            <span className={styles.returnIcon} aria-hidden>
              <ProjectIcon size={22} />
            </span>
            <span className={styles.returnText}>
              <span className="caption muted">WORKSPACE</span>
              <span className="body ellipsis">
                <strong>{activeProject.name}</strong>
                {activeFile && <span className="muted"> · {basename(activeFile)}</span>}
              </span>
            </span>
            <span className={cx('label', 'accent')} aria-hidden>
              Open ▸
            </span>
          </button>
          <Button
            variant="text"
            square
            className={styles.returnClose}
            aria-label={`Close project ${activeProject.name}`}
            onClick={onCloseProject}
          >
            <CloseIcon size={20} />
          </Button>
        </div>
      )}
    </>
  );
}

/** The active project: an empty editor with its tree laid over it, until a file opens (the editor takes over). */
function WorkspaceScreen({
  project,
  hasOpenFile,
  onOpenFile,
  onLeave,
}: {
  project: ProjectInfo;
  hasOpenFile: boolean;
  onOpenFile: (path: string) => void;
  /** Out to the explorer (back with no file open). */
  onLeave: () => void;
}) {
  const files = useFileSource();
  return (
    <>
      <TopBar
        title={project.name}
        subtitle={`WORKSPACE · ${SPACE_NAME}/${project.path}`}
        prefer="project."
        label={`Search commands · ${project.name}`}
        files={files}
      />
      {!hasOpenFile && <NoFileOpen key={project.path} onOpenFile={onOpenFile} onLeave={onLeave} />}
    </>
  );
}

function SpaceStatus({ state }: { state: 'creating' | 'error' }) {
  return (
    <>
      <HomeTopBar title="Projects" />
      {state === 'creating' ? (
        <p className={cx('label', 'cursor', styles.status)}>Mounting project space</p>
      ) : (
        <p className={cx('label', styles.status, styles.statusError)}>
          ✕ Project space error — storage is not writable
        </p>
      )}
    </>
  );
}

interface TeaserProps {
  label: string;
  sprint: string;
  description: string;
}

/** What a destination will be, while it is still on the roadmap. */
function Teaser({ label, sprint, description }: TeaserProps) {
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

function ComingSoon(props: TeaserProps) {
  return (
    <>
      <HomeTopBar
        title={props.label.charAt(0) + props.label.slice(1).toLowerCase()}
        subtitle={`${props.sprint} · ${BRAND}`}
      />
      <Teaser {...props} />
    </>
  );
}
