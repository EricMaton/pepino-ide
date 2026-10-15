import { createContext, useContext } from 'react';
import { CommandDispatcher, CommandRegistry } from '../core/commands';
import { EventBus } from '../core/events';
import { createCapacitorBackend } from '../features/projects/capacitorBackend';
import { createProjectSpace, type ProjectSpace } from '../features/projects/projectSpace';

export type AppEvents = {
  'demo.counterChanged': { count: number };
};

export interface Services {
  registry: CommandRegistry;
  dispatcher: CommandDispatcher;
  events: EventBus<AppEvents>;
  projectSpace: ProjectSpace;
}

export function createServices(): Services {
  const registry = new CommandRegistry();
  return {
    registry,
    dispatcher: new CommandDispatcher(registry),
    events: new EventBus<AppEvents>(),
    projectSpace: createProjectSpace(createCapacitorBackend()),
  };
}

export const ServicesContext = createContext<Services | null>(null);

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('useServices must be used inside <ServicesContext>');
  return services;
}
