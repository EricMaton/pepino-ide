export interface FileEntry {
  name: string;
  /** Relative to the project space root ('' is the root itself). */
  path: string;
  isDirectory: boolean;
  sizeBytes: number;
  modifiedMillis: number;
}

export type FileSortOrder = 'name' | 'size' | 'modified';

export const SORT_ORDERS: readonly FileSortOrder[] = ['name', 'size', 'modified'];

export const SORT_LABELS: Record<FileSortOrder, string> = {
  name: 'A-Z',
  size: 'SIZE',
  modified: 'MODIFIED',
};

export function nextSortOrder(order: FileSortOrder): FileSortOrder {
  const index = SORT_ORDERS.indexOf(order);
  return SORT_ORDERS[(index + 1) % SORT_ORDERS.length];
}

/** Directories first, then by the selected key (name as tiebreaker). */
export function sortEntries(entries: readonly FileEntry[], order: FileSortOrder): FileEntry[] {
  const byName = (a: FileEntry, b: FileEntry): number => a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  const byKey: Record<FileSortOrder, (a: FileEntry, b: FileEntry) => number> = {
    name: byName,
    size: (a, b) => b.sizeBytes - a.sizeBytes || byName(a, b),
    modified: (a, b) => b.modifiedMillis - a.modifiedMillis || byName(a, b),
  };
  return [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return byKey[order](a, b);
  });
}

export function isValidEntryName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed !== '.' && trimmed !== '..' && !trimmed.includes('/') && !trimmed.includes('\\');
}

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** Truncates to one decimal so a value never reads as the next unit ("1023.9 KB", not "1024 KB"). */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${(Math.floor(value * 10) / 10).toFixed(1)} ${SIZE_UNITS[unit]}`;
}

export function formatModified(millis: number): string {
  if (millis <= 0) return '—';
  const pad = (value: number): string => String(value).padStart(2, '0');
  const date = new Date(millis);
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Short type tag for a file badge: the extension, uppercased and capped at 4 chars ("TS", "JSON"). */
export function fileBadge(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '··';
  return name.slice(dot + 1, dot + 5).toUpperCase();
}
