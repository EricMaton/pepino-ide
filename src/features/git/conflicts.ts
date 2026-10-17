/*
 * A merge's conflicts in a file (#143): git leaves each clash as
 *
 *   <<<<<<< HEAD
 *   your lines
 *   ||||||| base       (only with diff3)
 *   =======
 *   GitHub's lines
 *   >>>>>>> origin/main
 *
 * The file reads as text and conflicts in turn; choosing a side for each
 * conflict gives the resolved file.
 */

/** A run of the file as it is, or one conflict: each side's lines (line breaks kept) and its label. */
export type ConflictSegment =
  | { kind: 'text'; text: string }
  | { kind: 'conflict'; ours: string; theirs: string; oursLabel: string; theirsLabel: string };

/** What a conflict becomes: your side, GitHub's, or both (yours first). */
export type ConflictChoice = 'ours' | 'theirs' | 'both';

const START = '<<<<<<<';
const BASE = '|||||||';
const MIDDLE = '=======';
const END = '>>>>>>>';

const isMarker = (line: string, marker: string) =>
  line.startsWith(marker) && (line.length === marker.length || /[\s]/.test(line[marker.length]));

const labelOf = (line: string, marker: string) => line.slice(marker.length).trim();

/** [text] as text and conflicts, in order. A conflict left unfinished reads as text. */
export function parseConflicts(text: string): ConflictSegment[] {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const segments: ConflictSegment[] = [];
  let plain = '';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!isMarker(line, START)) {
      plain += line;
      i++;
      continue;
    }
    // A conflict: ours up to ||||||| or =======, the base (skipped) up to =======, theirs up to >>>>>>>
    let j = i + 1;
    let ours = '';
    while (j < lines.length && !isMarker(lines[j], BASE) && !isMarker(lines[j], MIDDLE)) ours += lines[j++];
    while (j < lines.length && !isMarker(lines[j], MIDDLE)) j++;
    let theirs = '';
    let k = j + 1;
    while (k < lines.length && !isMarker(lines[k], END)) theirs += lines[k++];
    if (j >= lines.length || k >= lines.length) {
      plain += line;
      i++;
      continue;
    }
    if (plain) segments.push({ kind: 'text', text: plain });
    plain = '';
    segments.push({
      kind: 'conflict',
      ours,
      theirs,
      oursLabel: labelOf(line, START),
      theirsLabel: labelOf(lines[k], END),
    });
    i = k + 1;
  }
  if (plain) segments.push({ kind: 'text', text: plain });
  return segments;
}

/** How many conflicts [segments] has. */
export const conflictCount = (segments: readonly ConflictSegment[]) =>
  segments.filter((segment) => segment.kind === 'conflict').length;

/** Whether [text] still has a conflict's markers. */
export const hasConflicts = (text: string) => conflictCount(parseConflicts(text)) > 0;

/** A side ending without a line break would run into the next line: it gets one. */
const ended = (side: string) => (side === '' || side.endsWith('\n') ? side : `${side}\n`);

/**
 * The file with each conflict replaced by [choices] (by the conflict's
 * position); null while one is not chosen yet.
 */
export function resolveConflicts(
  segments: readonly ConflictSegment[],
  choices: readonly (ConflictChoice | undefined)[],
): string | null {
  let text = '';
  let index = 0;
  for (const segment of segments) {
    if (segment.kind === 'text') {
      text += segment.text;
      continue;
    }
    const choice = choices[index++];
    if (!choice) return null;
    text +=
      choice === 'ours' ? segment.ours : choice === 'theirs' ? segment.theirs : ended(segment.ours) + segment.theirs;
  }
  return text;
}
