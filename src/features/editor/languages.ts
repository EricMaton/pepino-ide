import type { StreamParser } from '@codemirror/language';
import type { Extension } from '@codemirror/state';

export interface LanguageDef {
  id: string;
  label: string;
  /** Loads the grammar on demand so languages never weigh on app start-up. */
  load: () => Promise<Extension>;
}

/** Wraps a CodeMirror 5 mode (Kotlin, Go, YAML…) for languages without a Lezer grammar. */
function legacy(load: () => Promise<StreamParser<unknown>>): () => Promise<Extension> {
  return async () => {
    const [{ StreamLanguage }, parser] = await Promise.all([import('@codemirror/language'), load()]);
    return StreamLanguage.define(parser);
  };
}

const js =
  (options: { typescript?: boolean; jsx?: boolean } = {}) =>
  async () =>
    (await import('@codemirror/lang-javascript')).javascript(options);

const LANGUAGES: Record<string, LanguageDef> = {
  typescript: { id: 'typescript', label: 'TypeScript', load: js({ typescript: true }) },
  tsx: { id: 'tsx', label: 'TSX', load: js({ typescript: true, jsx: true }) },
  javascript: { id: 'javascript', label: 'JavaScript', load: js() },
  jsx: { id: 'jsx', label: 'JSX', load: js({ jsx: true }) },
  json: { id: 'json', label: 'JSON', load: async () => (await import('@codemirror/lang-json')).json() },
  markdown: {
    id: 'markdown',
    label: 'Markdown',
    load: async () => (await import('@codemirror/lang-markdown')).markdown(),
  },
  html: { id: 'html', label: 'HTML', load: async () => (await import('@codemirror/lang-html')).html() },
  css: { id: 'css', label: 'CSS', load: async () => (await import('@codemirror/lang-css')).css() },
  python: { id: 'python', label: 'Python', load: async () => (await import('@codemirror/lang-python')).python() },
  kotlin: {
    id: 'kotlin',
    label: 'Kotlin',
    load: legacy(async () => (await import('@codemirror/legacy-modes/mode/clike')).kotlin),
  },
  java: {
    id: 'java',
    label: 'Java',
    load: legacy(async () => (await import('@codemirror/legacy-modes/mode/clike')).java),
  },
  c: { id: 'c', label: 'C', load: legacy(async () => (await import('@codemirror/legacy-modes/mode/clike')).c) },
  cpp: { id: 'cpp', label: 'C++', load: legacy(async () => (await import('@codemirror/legacy-modes/mode/clike')).cpp) },
  csharp: {
    id: 'csharp',
    label: 'C#',
    load: legacy(async () => (await import('@codemirror/legacy-modes/mode/clike')).csharp),
  },
  swift: {
    id: 'swift',
    label: 'Swift',
    load: legacy(async () => (await import('@codemirror/legacy-modes/mode/swift')).swift),
  },
  go: { id: 'go', label: 'Go', load: legacy(async () => (await import('@codemirror/legacy-modes/mode/go')).go) },
  rust: {
    id: 'rust',
    label: 'Rust',
    load: legacy(async () => (await import('@codemirror/legacy-modes/mode/rust')).rust),
  },
  shell: {
    id: 'shell',
    label: 'Shell',
    load: legacy(async () => (await import('@codemirror/legacy-modes/mode/shell')).shell),
  },
  yaml: {
    id: 'yaml',
    label: 'YAML',
    load: legacy(async () => (await import('@codemirror/legacy-modes/mode/yaml')).yaml),
  },
  toml: {
    id: 'toml',
    label: 'TOML',
    load: legacy(async () => (await import('@codemirror/legacy-modes/mode/toml')).toml),
  },
  sql: {
    id: 'sql',
    label: 'SQL',
    load: legacy(async () => (await import('@codemirror/legacy-modes/mode/sql')).standardSQL),
  },
};

const BY_EXTENSION: Record<string, keyof typeof LANGUAGES> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  json: 'json',
  md: 'markdown',
  markdown: 'markdown',
  html: 'html',
  htm: 'html',
  css: 'css',
  py: 'python',
  kt: 'kotlin',
  kts: 'kotlin',
  java: 'java',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  swift: 'swift',
  go: 'go',
  rs: 'rust',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  sql: 'sql',
};

/** The language for [fileName] by extension, or null for plain text. */
export function languageFor(fileName: string): LanguageDef | null {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = BY_EXTENSION[fileName.slice(dot + 1).toLowerCase()];
  return id ? LANGUAGES[id] : null;
}
