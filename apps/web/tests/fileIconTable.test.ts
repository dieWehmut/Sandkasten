import { describe, expect, test } from 'vitest';
import {
  dottedSuffixes,
  fileIconFor,
  fileIconGlyph,
  folderIconFor,
  folderIconGlyph,
} from '../src/editor/fileIcon';
import { DEFAULT_GLYPHS, FILE_ICONS_VERSION, ICON_GLYPHS } from '../src/editor/fileIconTable';

describe('vscode-icons table', () => {
  test('ships the pinned upstream release', () => {
    expect(FILE_ICONS_VERSION).toBe('12.19.0');
  });

  test('inlines every glyph as SVG markup without the upstream titles', () => {
    const ids = Object.keys(ICON_GLYPHS);
    expect(ids.length).toBeGreaterThan(1000);
    for (const id of ids) {
      expect(ICON_GLYPHS[id].startsWith('<svg'), `${id} must carry SVG markup`).toBe(true);
      expect(ICON_GLYPHS[id].includes('<title>'), `${id} must drop the upstream title`).toBe(false);
    }
    for (const theme of ['dark', 'light'] as const) {
      expect(ids).toContain(DEFAULT_GLYPHS[theme].file);
      expect(ids).toContain(DEFAULT_GLYPHS[theme].folder);
      expect(ids).toContain(DEFAULT_GLYPHS[theme].folderOpen);
    }
  });
});

describe('dottedSuffixes', () => {
  test('lists composed suffixes longest first and skips the dotfile prefix', () => {
    expect(dottedSuffixes('a.b.c')).toEqual(['b.c', 'c']);
    expect(dottedSuffixes('.gitignore')).toEqual([]);
    expect(dottedSuffixes('main.py')).toEqual(['py']);
    expect(dottedSuffixes('noext')).toEqual([]);
  });
});

describe('fileIconFor', () => {
  test('resolves an extension through the upstream language entry', () => {
    expect(fileIconFor('main.py')).toBe('_f_python');
    expect(fileIconFor('app.ts')).toBe('_f_typescript');
    expect(fileIconFor('src/index.js')).toBe('_f_js');
    expect(fileIconFor('main.go')).toBe('_f_go');
    expect(fileIconFor('lib.rs')).toBe('_f_rust');
    expect(fileIconFor('Main.java')).toBe('_f_java');
    expect(fileIconFor('view.vue')).toBe('_f_vue');
    expect(fileIconFor('notes.md')).toBe('_f_markdown');
    expect(fileIconFor('config.yaml')).toBe('_f_yaml');
  });

  test('resolves extension-only and header rules', () => {
    expect(fileIconFor('main.h')).toBe('_f_cheader');
    expect(fileIconFor('main.hpp')).toBe('_f_cppheader');
    expect(fileIconFor('photo.png')).toBe('_f_image');
    expect(fileIconFor('report.pdf')).toBe('_f_pdf');
    expect(fileIconFor('bundle.zip')).toBe('_f_zip');
  });

  test('prefers an exact file name over the extension', () => {
    expect(fileIconFor('package.json')).toBe('_f_npm');
    expect(fileIconFor('tsconfig.json')).toBe('_f_tsconfig');
    expect(fileIconFor('.gitignore')).toBe('_f_git');
    expect(fileIconFor('go.mod')).toBe('_f_go_package');
  });

  test('prefers a composed suffix over the bare extension', () => {
    expect(fileIconFor('cypress/login.cy.js')).toBe('_f_cypress_spec');
    expect(fileIconFor('app.tsx')).toBe('_f_reactts');
    expect(fileIconFor('component.jsx')).toBe('_f_reactjs');
  });

  test('ignores case and directory separators', () => {
    expect(fileIconFor('C:\\work\\MAIN.PY')).toBe('_f_python');
    expect(fileIconFor('nested/deep/package.json')).toBe('_f_npm');
  });

  test('falls back to the neutral file glyph for unknown names', () => {
    expect(fileIconFor('mystery.qqq')).toBe(DEFAULT_GLYPHS.dark.file);
    expect(fileIconFor('noext')).toBe(DEFAULT_GLYPHS.dark.file);
    expect(fileIconFor('')).toBe(DEFAULT_GLYPHS.dark.file);
    expect(fileIconFor(undefined)).toBe(DEFAULT_GLYPHS.dark.file);
    expect(fileIconFor('tool.wdl')).toBe(DEFAULT_GLYPHS.dark.file);
  });

  test('treats object prototype names as ordinary unknown paths', () => {
    for (const name of ['constructor', '__proto__', 'file.constructor', 'file.__proto__']) {
      expect(fileIconFor(name)).toBe(DEFAULT_GLYPHS.dark.file);
      expect(fileIconGlyph(name)).toBe(ICON_GLYPHS[DEFAULT_GLYPHS.dark.file]);
      expect(folderIconFor(name)).toBe(DEFAULT_GLYPHS.dark.folder);
    }
  });

  test('uses the upstream light variants in the light theme', () => {
    expect(fileIconFor('mystery.qqq', 'light')).toBe(DEFAULT_GLYPHS.light.file);
    expect(fileIconFor('src/index.js', 'light')).toBe('_f_light_js');
    expect(fileIconFor('lib.rs', 'light')).toBe('_f_light_rust');
    expect(fileIconFor('cypress/login.cy.js', 'light')).toBe('_f_light_cypress_spec');
    expect(fileIconFor('main.py', 'light')).toBe('_f_python');
  });
});

describe('fileIconGlyph', () => {
  test('returns markup from the inlined table, including the neutral fallback', () => {
    expect(fileIconGlyph('main.py')).toBe(ICON_GLYPHS._f_python);
    expect(fileIconGlyph('mystery.qqq')).toBe(ICON_GLYPHS[DEFAULT_GLYPHS.dark.file]);
    expect(fileIconGlyph('mystery.qqq', 'light')).toBe(ICON_GLYPHS[DEFAULT_GLYPHS.light.file]);
  });

  test('has a glyph for every resolvable icon', () => {
    const names = ['main.py', 'app.ts', 'index.js', 'main.go', 'package.json', 'bundle.zip', 'README'];
    for (const name of names) {
      expect(fileIconGlyph(name).startsWith('<svg')).toBe(true);
      expect(fileIconGlyph(name, 'light').startsWith('<svg')).toBe(true);
    }
  });
});

describe('folderIconFor', () => {
  test('resolves common folders and their expanded glyph', () => {
    expect(folderIconFor('src', false)).toBe('_fd_src');
    expect(folderIconFor('node_modules', false)).toBe('_fd_node');
    expect(folderIconFor('.github', false)).toBe('_fd_github');
    expect(folderIconFor('docs', false)).toBe('_fd_docs');
    expect(folderIconFor('tests', true)).toBe('_fd_test_open');
    expect(folderIconFor('src', true)).not.toBe(folderIconFor('src', false));
  });

  test('falls back for unknown folders and keeps the light glyphs', () => {
    expect(folderIconFor('zzz-folder', false)).toBe(DEFAULT_GLYPHS.dark.folder);
    expect(folderIconFor('zzz-folder', true)).toBe(DEFAULT_GLYPHS.dark.folderOpen);
    expect(folderIconFor('zzz-folder', false, 'light')).toBe(DEFAULT_GLYPHS.light.folder);
    expect(folderIconFor('zzz-folder', true, 'light')).toBe(DEFAULT_GLYPHS.light.folderOpen);
  });

  test('uses the upstream light override where one exists', () => {
    expect(folderIconFor('electron', false, 'light')).toBe('_fd_light_electron');
    expect(folderIconFor('electron', false, 'dark')).toBe(folderIconFor('electron', false));
  });

  test('exposes a glyph for the resolved folder id', () => {
    expect(folderIconGlyph('src', false)).toBe(ICON_GLYPHS._fd_src);
    expect(folderIconGlyph('src', true)).toBe(ICON_GLYPHS._fd_src_open);
  });
});
