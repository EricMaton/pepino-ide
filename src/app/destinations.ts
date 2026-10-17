export type AppDestination = 'projects' | 'git' | 'terminal' | 'settings';

export interface DestinationInfo {
  id: AppDestination;
  label: string;
  /** Shown while the destination is still on the roadmap. */
  teaser?: { sprint: string; description: string };
}

export const DESTINATIONS: readonly DestinationInfo[] = [
  { id: 'projects', label: 'PROJECTS' },
  {
    id: 'git',
    label: 'GIT',
    teaser: { sprint: 'SPRINTS 3–4', description: 'Commits, branches, diffs and GitHub sync, all by touch.' },
  },
  { id: 'terminal', label: 'TERMINAL' },
  { id: 'settings', label: 'SETTINGS' },
];

export const HOME: AppDestination = 'projects';
