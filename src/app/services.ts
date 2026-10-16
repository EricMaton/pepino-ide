import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { createContext, useContext } from 'react';
import { CommandDispatcher, CommandRegistry } from '../core/commands';
import { EventBus } from '../core/events';
import { createMemoryGitEngine, createNativeGitEngine, type GitEngine } from '../features/git/engine';
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
    ? createNativeGitEngine((path) => events.publish('fs.created', { path }))
    : createMemoryGitEngine(projectSpace);

  // Recents only listen to the bus: whoever opens a project doesn't need to know about them.
  events.subscribe('project.opened', (project) => {
    recentProjects.record(project.path).catch((error: unknown) => console.error('Cannot record recent project', error));
  });

  return {
    registry,
    dispatcher: new CommandDispatcher(registry),
    events,
    projectSpace,
    recentProjects,
    session,
    workspace,
    git,
    preferences,
  };
}

export const ServicesContext = createContext<Services | null>(null);

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('useServices must be used inside <ServicesContext>');
  return services;
}
