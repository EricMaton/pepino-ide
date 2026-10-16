import type { ChangeKind } from './engine';

/** How each kind of change is marked in a list of files. */
export const KIND_MARKS: Record<ChangeKind, { mark: string; label: string }> = {
  new: { mark: '+', label: 'New' },
  modified: { mark: '•', label: 'Modified' },
  deleted: { mark: '−', label: 'Deleted' },
  conflicted: { mark: '!', label: 'Conflicted' },
};
