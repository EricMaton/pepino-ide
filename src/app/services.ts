import { Preferences } from '@capacitor/preferences';
import { createContext, useContext } from 'react';
import { CommandDispatcher, CommandRegistry } from '../core/commands';
import { EventBus } from '../core/events';
import { createCapacitorBackend } from '../features/projects/capacitorBackend';
import type { ProjectInfo } from '../features/projects/projects';
import { createProjectSpace, type ProjectSpace } from '../features/projects/projectSpace';
import { createRecentProjects, type KeyValueStore, type RecentProjects } from '../features/projects/recents';

export type AppEvents = {
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
}

/** Capacitor Preferences: SharedPreferences on Android, UserDefaults on iOS, localStorage on the web. */
const preferences: KeyValueStore = {
  get: async (key) => (await Preferences.get({ key })).value,
  set: (key, value) => Preferences.set({ key, value }),
};

export function createServices(): Services {
  const registry = new CommandRegistry();
  const events = new EventBus<AppEvents>();
  const projectSpace = createProjectSpace(createCapacitorBackend());
  const recentProjects = createRecentProjects(preferences, projectSpace);

  // Recents only listen to the bus: whoever opens a project doesn't need to know about them.
  events.subscribe('project.opened', (project) => {
    recentProjects.record(project.path).catch((error: unknown) => console.error('Cannot record recent project', error));
  });

  return { registry, dispatcher: new CommandDispatcher(registry), events, projectSpace, recentProjects };
}

export const ServicesContext = createContext<Services | null>(null);

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('useServices must be used inside <ServicesContext>');
  return services;
}
