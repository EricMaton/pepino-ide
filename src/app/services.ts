import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { createContext, useContext } from 'react';
import { CommandDispatcher, CommandRegistry } from '../core/commands';
import { EventBus } from '../core/events';
import { createFileHistory, type FileHistory } from '../features/editor/fileHistory';
import { createMemoryGitEngine, createNativeGitEngine, type GitEngine } from '../features/git/engine';
import { createNativeTerminal, createUnavailableTerminal, type TerminalBackend } from '../features/terminal/terminal';
import { createThemeStore, type ThemeStore } from '../ui/themeStore';
import { createEditorSettingsStore, type EditorSettingsStore } from '../features/editor/editorSettings';
import { type ActiveEditor, createActiveEditor } from '../features/editor/activeEditor';
import { createWorkerConnection } from '../features/plugins/connection';
import { PluginHost } from '../features/plugins/host';
import { builtinSource } from '../features/plugins/loader';
import { capacitorPluginFolders, installedPlugins } from '../features/plugins/installed';
import { PluginManager } from '../features/plugins/manager';
import { createRegistry, type PluginRegistry } from '../features/plugins/registry';
import { createPluginPermissions } from '../features/plugins/permissions';
import { createRepositories, type Repositories } from '../features/git/repositories';
import { createMemoryGitHub, createNativeGitHub, type GitHub } from '../features/github/github';
import { createCapacitorBackend } from '../features/projects/capacitorBackend';
import { type FsEvents, observeProjectSpace } from '../features/projects/observed';
import type { ProjectInfo } from '../features/projects/projects';
import { createProjectSpace, type ProjectSpace } from '../features/projects/projectSpace';
import type { KeyValueStore } from '../core/storage';
import { createRecentProjects, type RecentProjects } from '../features/projects/recents';
import { createWorkspace, type Workspace, type WorkspaceEvents } from '../features/workspace/workspace';
import { createSessionStore, type SessionStore } from './session';

export type AppEvents = FsEvents &
  WorkspaceEvents & {
    'demo.counterChanged': { count: number };
    'project.opened': ProjectInfo;
    'project.closed': ProjectInfo;
    'file.opened': { path: string };
    'file.saved': { path: string };
    /** An edit in the editor (#48): plugins' api.editor.onChange. */
    'editor.changed': { path: string };
  };

export interface Services {
  registry: CommandRegistry;
  dispatcher: CommandDispatcher;
  events: EventBus<AppEvents>;
  projectSpace: ProjectSpace;
  recentProjects: RecentProjects;
  session: SessionStore;
  workspace: Workspace;
  /** Git on the projects (ADR-006): JGit on Android, a stand-in on the web. */
  git: GitEngine;
  /** The repositories added to GIT, like GitHub Desktop's list. */
  repositories: Repositories;
  /** Files' earlier versions, kept before the editor overwrites them (#27). */
  fileHistory: FileHistory;
  /** GitHub sign-in (#29): the token stays native, in the Keystore (#30). */
  github: GitHub;
  /** Shells on a PTY (#37): Android only; iOS and the web have none. */
  terminal: TerminalBackend;
  /** The editor on screen (#48), for plugins' api.editor. */
  activeEditor: ActiveEditor;
  /** The running plugins (#46–#50): each in a sandboxed worker, reached through commands and events. */
  pluginHost: PluginHost;
  /** Every plugin found, on or off, and what the user approved it to do (#49). */
  plugins: PluginManager;
  /** The plugins that can be installed (#55, #56): EricMaton/pepino-plugins. */
  pluginRegistry: PluginRegistry;
  /** The editor's settings (#45): font size, tabs, wrap, line numbers; every editor follows. */
  editorSettings: EditorSettingsStore;
  /** The theme (#44): dark, light, the phone's, or custom; applied to the whole page. */
  theme: ThemeStore;
  /** Small user preferences (editor font size…), persisted across restarts. */
  preferences: KeyValueStore;
}

/** Capacitor Preferences: SharedPreferences on Android, UserDefaults on iOS, localStorage on the web. */
const preferences: KeyValueStore = {
  get: async (key) => (await Preferences.get({ key })).value,
  set: (key, value) => Preferences.set({ key, value }),
};

export function createServices(): Services {
  const registry = new CommandRegistry();
  const events = new EventBus<AppEvents>();
  // Every change to the project space is announced on the bus (fs.*), whoever makes it.
  const projectSpace = observeProjectSpace(createProjectSpace(createCapacitorBackend()), (topic, payload) =>
    events.publish(topic, payload as never),
  );
  const recentProjects = createRecentProjects(preferences, projectSpace);
  const repositories = createRepositories(preferences, projectSpace);
  const session = createSessionStore(preferences);
  const workspace = createWorkspace(projectSpace, events, {
    load: async (root) => {
      const saved = await session.load();
      return { files: saved.openFiles[root] ?? [], active: saved.activeFiles[root] ?? null };
    },
    save: (root, files, active) =>
      session.update((saved) => {
        const activeFiles = { ...saved.activeFiles };
        if (active) activeFiles[root] = active;
        else delete activeFiles[root];
        return { ...saved, openFiles: { ...saved.openFiles, [root]: [...files] }, activeFiles };
      }),
  });

  const git = Capacitor.isNativePlatform()
    ? createNativeGitEngine((topic, payload) => events.publish(topic, payload as never))
    : createMemoryGitEngine(projectSpace);
  const fileHistory = createFileHistory(projectSpace, git);
  let github: GitHub;
  if (Capacitor.isNativePlatform()) {
    github = createNativeGitHub();
  } else {
    const memory = createMemoryGitHub();
    github = memory;
    // `pepinoDev.expireGitHub()` in the console: GitHub refusing the token, to try signing in again (#36)
    if (import.meta.env.DEV) Object.assign(globalThis, { pepinoDev: { expireGitHub: () => memory.expire() } });
  }

  // Recents only listen to the bus: whoever opens a project doesn't need to know about them.
  events.subscribe('project.opened', (project) => {
    recentProjects.record(project.path).catch((error: unknown) => console.error('Cannot record recent project', error));
  });

  const dispatcher = new CommandDispatcher(registry);
  const activeEditor = createActiveEditor();
  const pluginPermissions = createPluginPermissions(preferences);
  const pluginHost = new PluginHost({
    registry,
    dispatcher,
    events,
    activeEditor,
    connect: createWorkerConnection,
    allowed: (plugin, permission) => pluginPermissions.allowed(plugin, permission),
    storage: preferences,
  });
  const installed = installedPlugins(capacitorPluginFolders());
  const plugins = new PluginManager(pluginHost, pluginPermissions, () => [builtinSource(), installed], installed);
  const theme = createThemeStore(preferences);
  // The themes plugins bring (#52), as they load, start and stop
  let pluginThemes = '';
  plugins.subscribe(() => {
    const themes = plugins.themes();
    if (themes === null || JSON.stringify(themes) === pluginThemes) return;
    pluginThemes = JSON.stringify(themes);
    theme.setContributed(themes);
  });

  return {
    registry,
    dispatcher,
    events,
    projectSpace,
    recentProjects,
    session,
    workspace,
    git,
    repositories,
    fileHistory,
    github,
    terminal: Capacitor.getPlatform() === 'android' ? createNativeTerminal() : createUnavailableTerminal(),
    theme,
    editorSettings: createEditorSettingsStore(preferences),
    activeEditor,
    pluginHost,
    plugins,
    pluginRegistry: createRegistry(),
    preferences,
  };
}

export const ServicesContext = createContext<Services | null>(null);

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('useServices must be used inside <ServicesContext>');
  return services;
}
