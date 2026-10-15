export type AppDestination = 'projects' | 'git' | 'settings';

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
  {
    id: 'settings',
    label: 'SETTINGS',
    teaser: { sprint: 'SPRINT 6', description: 'Themes, editor preferences and plugins.' },
  },
];

export const HOME: AppDestination = 'projects';
