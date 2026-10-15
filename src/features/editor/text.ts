import type { Text } from '@codemirror/state';

export type LineSeparator = '\n' | '\r\n' | '\r';

/** The file's dominant line ending, so saving never rewrites a CRLF file as LF. */
export function detectLineSeparator(text: string): LineSeparator {
  const crlf = text.match(/\r\n/g)?.length ?? 0;
  const lf = (text.match(/\n/g)?.length ?? 0) - crlf;
  const cr = (text.match(/\r/g)?.length ?? 0) - crlf;
  if (crlf > 0 && crlf >= lf && crlf >= cr) return '\r\n';
  if (cr > lf) return '\r';
  return '\n';
}

/** Document text joined with [separator] (CodeMirror itself always uses `\n`). */
export function serialize(doc: Text, separator: LineSeparator): string {
  return doc.sliceString(0, doc.length, separator);
}
