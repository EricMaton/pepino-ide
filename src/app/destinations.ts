export type AppDestination = 'projects' | 'git' | 'terminal' | 'plugins' | 'settings';

export interface DestinationInfo {
  id: AppDestination;
  label: string;
  /** What it is, in the MORE sheet (#171). */
  description: string;
  /** Shown while the destination is still on the roadmap. */
  teaser?: { sprint: string; description: string };
}

export const DESTINATIONS: readonly DestinationInfo[] = [
  { id: 'projects', label: 'PROJECTS', description: 'Your projects, their files and the editor' },
  {
    id: 'git',
    label: 'GIT',
    description: 'Changes, history, branches and GitHub',
    teaser: { sprint: 'SPRINTS 3–4', description: 'Commits, branches, diffs and GitHub sync, all by touch.' },
  },
  { id: 'terminal', label: 'TERMINAL', description: 'A shell in the open project' },
  { id: 'plugins', label: 'PLUGINS', description: 'What plugins add, and what they may do' },
  { id: 'settings', label: 'SETTINGS', description: 'Accounts, theme and editor' },
];

export const HOME: AppDestination = 'projects';
