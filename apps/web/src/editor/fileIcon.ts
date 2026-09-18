// File-type visuals for the workbench: which glyph a language gets and which
// hue family it belongs to. Kept as plain data so the explorer, the tab strip,
// and the tests can share one source of truth without mounting a component.
export type FileIconTone = 'blue' | 'yellow' | 'green' | 'orange' | 'purple' | 'red' | 'cyan' | 'slate';

export type FileIconShape = 'code' | 'braces' | 'json' | 'text' | 'terminal' | 'markup' | 'style' | 'data';

export interface FileVisual {
  shape: FileIconShape;
  tone: FileIconTone;
}

const DEFAULT_VISUAL: FileVisual = { shape: 'text', tone: 'slate' };

// Grouped by family rather than listed per extension, so adding a runtime to
// language.ts only needs a family entry here.
const LANGUAGE_VISUALS: Readonly<Record<string, FileVisual>> = {
  python: { shape: 'code', tone: 'blue' },
  javascript: { shape: 'braces', tone: 'yellow' },
  typescript: { shape: 'braces', tone: 'blue' },
  tsx: { shape: 'code', tone: 'cyan' },
  go: { shape: 'code', tone: 'cyan' },
  rust: { shape: 'code', tone: 'orange' },
  c: { shape: 'code', tone: 'blue' },
  cpp: { shape: 'code', tone: 'blue' },
  csharp: { shape: 'code', tone: 'green' },
  fsharp: { shape: 'code', tone: 'cyan' },
  java: { shape: 'code', tone: 'red' },
  kotlin: { shape: 'code', tone: 'purple' },
  scala: { shape: 'code', tone: 'red' },
  swift: { shape: 'code', tone: 'orange' },
  dart: { shape: 'code', tone: 'cyan' },
  ruby: { shape: 'code', tone: 'red' },
  php: { shape: 'code', tone: 'purple' },
  perl: { shape: 'code', tone: 'cyan' },
  lua: { shape: 'code', tone: 'blue' },
  r: { shape: 'data', tone: 'blue' },
  julia: { shape: 'code', tone: 'purple' },
  matlab: { shape: 'data', tone: 'orange' },
  octave: { shape: 'data', tone: 'orange' },
  fortran: { shape: 'code', tone: 'purple' },
  pascal: { shape: 'code', tone: 'blue' },
  basic: { shape: 'code', tone: 'red' },
  cangjie: { shape: 'code', tone: 'red' },
  zig: { shape: 'code', tone: 'orange' },
  nim: { shape: 'code', tone: 'yellow' },
  crystal: { shape: 'code', tone: 'slate' },
  vlang: { shape: 'code', tone: 'blue' },
  gleam: { shape: 'code', tone: 'purple' },
  gdscript: { shape: 'code', tone: 'blue' },
  haskell: { shape: 'code', tone: 'purple' },
  ocaml: { shape: 'code', tone: 'orange' },
  elixir: { shape: 'code', tone: 'purple' },
  erlang: { shape: 'code', tone: 'red' },
  clojure: { shape: 'code', tone: 'green' },
  racket: { shape: 'code', tone: 'red' },
  bash: { shape: 'terminal', tone: 'green' },
  sql: { shape: 'data', tone: 'cyan' },
  wdl: { shape: 'data', tone: 'purple' },
  json: { shape: 'json', tone: 'yellow' },
  html: { shape: 'markup', tone: 'orange' },
  css: { shape: 'style', tone: 'cyan' },
  scss: { shape: 'style', tone: 'purple' },
  vue3: { shape: 'code', tone: 'green' },
  qml: { shape: 'code', tone: 'green' },
  markdown: { shape: 'markup', tone: 'blue' },
  mdx: { shape: 'markup', tone: 'blue' },
  latex: { shape: 'markup', tone: 'green' },
  typst: { shape: 'markup', tone: 'cyan' },
  graphviz: { shape: 'data', tone: 'orange' },
};

/** Resolve the glyph and hue for a canonical runtime name; unknown names fall back to a plain file. */
export function fileVisualFor(language: string | undefined | null): FileVisual {
  const name = String(language ?? '').trim().toLowerCase();
  return LANGUAGE_VISUALS[name] ?? DEFAULT_VISUAL;
}