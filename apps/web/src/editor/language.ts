import type { Extension } from '@codemirror/state';
import { cpp } from '@codemirror/lang-cpp';
import { css } from '@codemirror/lang-css';
import { go } from '@codemirror/lang-go';
import { html } from '@codemirror/lang-html';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { sql } from '@codemirror/lang-sql';
import { yaml } from '@codemirror/lang-yaml';
// CodeMirror has no first-party shell grammar; the maintained stream parser in
// legacy-modes is what the project recommends for it.
import { StreamLanguage } from '@codemirror/language';
import { shell } from '@codemirror/legacy-modes/mode/shell';

/**
 * Return a syntax extension for the runtime name, or null for plain text.
 *
 * Every runtime in `EXTENSION_LANGUAGES` that CodeMirror ships a parser for is
 * wired here, because a mapped extension that resolves to no parser renders the
 * file as flat text while the explorer still labels it with a language icon.
 * The remaining runtimes keep the plain-text fallback until a parser exists.
 */
export function languageExtensionForRuntime(runtime: string | undefined | null): Extension | null {
  const name = String(runtime ?? '').trim().toLowerCase();
  switch (name) {
    case 'javascript':
    case 'js':
    case 'node':
      return javascript();
    case 'typescript':
    case 'ts':
      return javascript({ typescript: true });
    case 'tsx':
    case 'jsx':
      return javascript({ typescript: true, jsx: true });
    case 'python':
    case 'py':
    case 'python3':
      return python();
    case 'go':
    case 'golang':
      return go();
    case 'rust':
    case 'rs':
      return rust();
    case 'c':
      return cpp();
    case 'cpp':
    case 'c++':
      return cpp();
    case 'java':
      return java();
    case 'json':
      return json();
    case 'css':
      return css();
    case 'scss':
      // The CSS parser reads SCSS's declarations and nesting; the at-rules it
      // does not know still tokenize as punctuation instead of plain text.
      return css();
    case 'html':
      return html();
    case 'vue3':
    case 'vue':
      // A single-file component is markup with script and style blocks, which
      // the HTML parser highlights in all three sections.
      return html();
    case 'markdown':
    case 'md':
      return markdown();
    case 'mdx':
      return markdown();
    case 'sql':
      return sql();
    case 'yaml':
      return yaml();
    case 'bash':
    case 'sh':
    case 'zsh':
      return StreamLanguage.define(shell);
    default:
      return null;
  }
}

// Extension to canonical Sandkasten runtime name. Shared by the workspace
// explorer (which language a file opens as) and the local runner.
const EXTENSION_LANGUAGES: Readonly<Record<string, string>> = {
  py: 'python', pyw: 'python',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript',
  jsx: 'tsx', tsx: 'tsx',
  go: 'go',
  rs: 'rust',
  c: 'c', h: 'c',
  cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp',
  java: 'java',
  kt: 'kotlin', kts: 'kotlin',
  swift: 'swift',
  zig: 'zig',
  nim: 'nim',
  rb: 'ruby',
  php: 'php',
  pl: 'perl',
  lua: 'lua',
  r: 'r',
  jl: 'julia',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  hs: 'haskell',
  ml: 'ocaml', mli: 'ocaml',
  ex: 'elixir', exs: 'elixir',
  erl: 'erlang',
  clj: 'clojure',
  cr: 'crystal',
  dart: 'dart',
  cs: 'csharp',
  fs: 'fsharp', fsx: 'fsharp',
  f90: 'fortran', f95: 'fortran',
  m: 'octave',
  sc: 'scala',
  rkt: 'racket',
  cj: 'cangjie',
  gleam: 'gleam',
  gd: 'gdscript',
  v: 'vlang',
  sql: 'sql',
  json: 'json',
  yaml: 'yaml', yml: 'yaml',
  html: 'html', htm: 'html',
  css: 'css',
  scss: 'scss',
  vue: 'vue3',
  md: 'markdown', mdx: 'mdx',
  dot: 'graphviz', gv: 'graphviz',
  tex: 'latex',
  typ: 'typst',
  qml: 'qml',
  wdl: 'wdl',
};

// The status bar names the language mode the way VS Code does: branded and
// acronym runtime names keep their own spelling instead of a naive
// capitalize-first, and anything unknown falls back to that capitalization.
const LANGUAGE_MODE_NAMES: Readonly<Record<string, string>> = {
  assembly: 'Assembly',
  bash: 'Shell Script',
  c: 'C',
  cangjie: 'Cangjie',
  clojure: 'Clojure',
  coq: 'Coq',
  cpp: 'C++',
  csharp: 'C#',
  css: 'CSS',
  csv: 'CSV',
  dart: 'Dart',
  elixir: 'Elixir',
  erlang: 'Erlang',
  fortran: 'Fortran',
  fsharp: 'F#',
  gdscript: 'GDScript',
  gleam: 'Gleam',
  go: 'Go',
  graphviz: 'Graphviz',
  haskell: 'Haskell',
  html: 'HTML',
  java: 'Java',
  javascript: 'JavaScript',
  json: 'JSON',
  julia: 'Julia',
  kotlin: 'Kotlin',
  latex: 'LaTeX',
  lean4: 'Lean 4',
  less: 'Less',
  lua: 'Lua',
  markdown: 'Markdown',
  mdx: 'MDX',
  mojo: 'Mojo',
  nextjs: 'Next.js',
  nextflow: 'Nextflow',
  nim: 'Nim',
  ocaml: 'OCaml',
  octave: 'GNU Octave',
  pascal: 'Pascal',
  perl: 'Perl',
  php: 'PHP',
  prolog: 'Prolog',
  python: 'Python',
  qml: 'QML',
  r: 'R',
  racket: 'Racket',
  ruby: 'Ruby',
  rust: 'Rust',
  sass: 'Sass',
  scala: 'Scala',
  scss: 'SCSS',
  sql: 'SQL',
  swift: 'Swift',
  tailwind: 'Tailwind CSS',
  toml: 'TOML',
  tsx: 'TSX',
  typescript: 'TypeScript',
  typst: 'Typst',
  vlang: 'V',
  vue3: 'Vue',
  wdl: 'WDL',
  xml: 'XML',
  yaml: 'YAML',
  zig: 'Zig',
};

/** Name the language mode for the runtime, or '' when no runtime is selected. */
export function languageModeLabel(runtime: string | undefined | null): string {
  const name = String(runtime ?? '').trim();
  if (!name) return '';
  return LANGUAGE_MODE_NAMES[name.toLowerCase()] ?? name.charAt(0).toUpperCase() + name.slice(1);
}

/** Resolve the canonical runtime name for a file path, or '' when unknown. */
export function languageForPath(path: string | undefined | null): string {
  const name = String(path ?? '').trim();
  const base = name.split(/[\\/]/).at(-1) ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return EXTENSION_LANGUAGES[base.slice(dot + 1).toLowerCase()] ?? '';
}
