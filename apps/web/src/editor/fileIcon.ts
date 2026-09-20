// Which vscode-icons glyph a workspace entry gets.
//
// The tables come from the published vscode-icons theme (see
// scripts/generate-file-icons.mjs), so the workbench shows the same glyphs VS
// Code does. Resolution follows the extension's own precedence: a composed
// suffix such as `cy.js` outranks the plain `js`, an exact file name outranks a
// suffix, and the editor language only decides when neither matched.
import {
  DEFAULT_GLYPHS,
  EXTENSION_ICONS,
  FILE_NAME_ICONS,
  FOLDER_ICONS,
  FOLDER_OPEN_ICONS,
  ICON_GLYPHS,
  LANGUAGE_ICONS,
  LIGHT_ICON_OVERRIDES,
} from './fileIconTable';

export type IconTheme = 'light' | 'dark';

/**
 * Every dotted suffix of a file name, longest first: `a.b.c` yields `b.c`
 * and `c`. Upstream stores composed suffixes such as `cy.js`, so the
 * longest match has to win over the bare extension.
 */
export function dottedSuffixes(name: string): string[] {
  const suffixes: string[] = [];
  for (let index = 1; index < name.length; index += 1) {
    if (name[index] !== '.') continue;
    const suffix = name.slice(index + 1);
    if (suffix) suffixes.push(suffix);
  }
  return suffixes;
}

function baseName(path: string | undefined | null): string {
  const name = String(path ?? '').trim();
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  return (slash === -1 ? name : name.slice(slash + 1)).toLowerCase();
}

function entry(table: Readonly<Record<string, string>> | undefined, key: string): string | undefined {
  return table && Object.hasOwn(table, key) ? table[key] : undefined;
}

// Upstream identifies some languages by a differently-cased id (`Cangjie`), and
// the workbench names the same languages after their runtime, so both lookups
// go through a normalized index.
const LANGUAGE_INDEX: ReadonlyMap<string, string> = new Map(
  Object.entries(LANGUAGE_ICONS).map(([id, icon]) => [id.toLowerCase(), icon]),
);

// Runtime and extension spellings that upstream keys by another language id.
const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  js: 'javascript',
  node: 'javascript',
  ts: 'typescript',
  tsx: 'typescriptreact',
  jsx: 'javascriptreact',
  py: 'python',
  python3: 'python',
  golang: 'go',
  rs: 'rust',
  'c++': 'cpp',
  cs: 'csharp',
  fs: 'fsharp',
  rb: 'ruby',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  vue: 'vue',
  vue3: 'vue',
  md: 'markdown',
  m: 'matlab',
  octave: 'matlab',
  cj: 'cangjie',
  dot: 'graphviz',
  gv: 'graphviz',
};

/** Resolve the upstream language id for a file name, if the theme covers it. */
function iconLanguageFor(name: string): string | undefined {
  for (const suffix of dottedSuffixes(name)) {
    const candidate = entry(LANGUAGE_ALIASES, suffix) ?? suffix;
    if (LANGUAGE_INDEX.has(candidate)) return candidate;
  }
  return undefined;
}

/** The upstream icon id for a file path, or the neutral glyph when nothing matches. */
export function fileIconFor(path: string | undefined | null, theme: IconTheme = 'dark'): string {
  const name = baseName(path);
  if (!name) return DEFAULT_GLYPHS[theme].file;

  const lightNames = theme === 'light' ? LIGHT_ICON_OVERRIDES.filenames : undefined;
  const named = entry(lightNames, name) ?? entry(FILE_NAME_ICONS, name);
  if (named) return named;

  const lightExtensions = theme === 'light' ? LIGHT_ICON_OVERRIDES.extensions : undefined;
  for (const suffix of dottedSuffixes(name)) {
    const bySuffix = entry(lightExtensions, suffix) ?? entry(EXTENSION_ICONS, suffix);
    if (bySuffix) return bySuffix;
  }

  const language = iconLanguageFor(name);
  if (language) {
    const lightLanguages = theme === 'light' ? LIGHT_ICON_OVERRIDES.languages : undefined;
    const byLanguage = entry(lightLanguages, language)
      ?? LANGUAGE_INDEX.get(language)
      ?? entry(LANGUAGE_ICONS, language);
    if (byLanguage) return byLanguage;
  }

  return DEFAULT_GLYPHS[theme].file;
}

/** The upstream icon id for a folder name, expanded or not. */
export function folderIconFor(name: string | undefined | null, expanded = false, theme: IconTheme = 'dark'): string {
  const key = baseName(name);
  const overrides = theme === 'light'
    ? (expanded ? LIGHT_ICON_OVERRIDES.foldersOpen : LIGHT_ICON_OVERRIDES.folders)
    : undefined;
  const resolved = entry(overrides, key) ?? entry(expanded ? FOLDER_OPEN_ICONS : FOLDER_ICONS, key);
  if (resolved) return resolved;
  return expanded ? DEFAULT_GLYPHS[theme].folderOpen : DEFAULT_GLYPHS[theme].folder;
}

/** The SVG markup for a file path. */
export function fileIconGlyph(path: string | undefined | null, theme: IconTheme = 'dark'): string {
  const id = fileIconFor(path, theme);
  return ICON_GLYPHS[id] ?? ICON_GLYPHS[DEFAULT_GLYPHS[theme].file];
}

/** The SVG markup for a folder name. */
export function folderIconGlyph(name: string | undefined | null, expanded = false, theme: IconTheme = 'dark'): string {
  const id = folderIconFor(name, expanded, theme);
  return ICON_GLYPHS[id] ?? ICON_GLYPHS[DEFAULT_GLYPHS[theme].folder];
}
