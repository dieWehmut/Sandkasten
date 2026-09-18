import type { Extension } from '@codemirror/state';
import { cpp } from '@codemirror/lang-cpp';
import { go } from '@codemirror/lang-go';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';

/** Return a syntax extension for the runtime name, or null for plain text. */
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

/** Resolve the canonical runtime name for a file path, or '' when unknown. */
export function languageForPath(path: string | undefined | null): string {
  const name = String(path ?? '').trim();
  const base = name.split(/[\\/]/).at(-1) ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return EXTENSION_LANGUAGES[base.slice(dot + 1).toLowerCase()] ?? '';
}
