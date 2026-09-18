import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

import { sourceHighlighting, vscodeDarkPlusColors, vscodeLightPlusColors } from '../src/editor/highlight';

const sourceDirectory = resolve(import.meta.dirname, '../src');
const highlightSource = readFileSync(resolve(sourceDirectory, 'editor/highlight.ts'), 'utf8');
const tokens = readFileSync(resolve(sourceDirectory, 'styles/tokens.css'), 'utf8');
const [lightTokens, darkTokens] = tokens.split(':root[data-theme="dark"]');

describe('editor syntax highlighting', () => {
  test('every referenced syntax token exists in both themes', () => {
    const referenced = new Set(Array.from(highlightSource.matchAll(/var\((--syntax-[\w-]+)\)/g), (match) => match[1]));
    expect(referenced.size).toBeGreaterThan(15);
    for (const name of referenced) {
      expect(lightTokens, `${name} light`).toContain(`${name}:`);
      expect(darkTokens, `${name} dark`).toContain(`${name}:`);
    }
  });

  test('the VS Code palettes stay complete and distinct per theme', () => {
    const keys = Object.keys(vscodeLightPlusColors).sort();
    expect(Object.keys(vscodeDarkPlusColors).sort()).toEqual(keys);
    expect(keys).toContain('comment');
    expect(keys).toContain('keyword');
    expect(vscodeDarkPlusColors.comment).toBe('#6A9955');
    expect(vscodeLightPlusColors.comment).toBe('#008000');
    expect(Object.values(vscodeLightPlusColors).every((value) => /^#[0-9A-F]{6}$/.test(value))).toBe(true);
    expect(Object.values(vscodeDarkPlusColors).every((value) => /^#[0-9A-F]{6}$/.test(value))).toBe(true);
  });

  test('the editor extension is the VS Code highlight style, not the CodeMirror default', () => {
    const editorSource = readFileSync(resolve(sourceDirectory, 'components/SourceEditor.vue'), 'utf8');
    expect(editorSource).toContain('sourceHighlighting()');
    expect(editorSource).not.toContain('defaultHighlightStyle');
    expect(sourceHighlighting()).toBeTruthy();
  });
});