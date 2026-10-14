export type AppDestination = 'projects' | 'git' | 'settings';

export const DESTINATIONS: ReadonlyArray<{ id: AppDestination; label: string }> = [
  { id: 'projects', label: 'PROJECTS' },
  { id: 'git', label: 'GIT' },
  { id: 'settings', label: 'SETTINGS' },
];

export const HOME: AppDestination = 'projects';
