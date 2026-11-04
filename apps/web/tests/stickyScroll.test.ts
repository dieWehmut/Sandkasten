import { EditorState } from '@codemirror/state';
import { describe, expect, test } from 'vitest';
import { DEFAULT_EDITOR_SETTINGS, normalizeUserSettings } from '../src/state/editorSettings';
import { indentOf, MAX_STICKY_LINES, stickyScopes } from '../src/editor/stickyScroll';

function stateOf(lines: string[]): EditorState {
  return EditorState.create({ doc: lines.join('\n') });
}

describe('sticky scroll scope tracker', () => {
  test('counts leading columns for spaces, tabs and mixes', () => {
    expect(indentOf('    value', 4)).toBe(4);
    expect(indentOf('\tvalue', 4)).toBe(4);
    expect(indentOf('  \tvalue', 4)).toBe(6);
    expect(indentOf('value', 4)).toBe(0);
  });

  test('pins the enclosing scopes, outermost first', () => {
    const state = stateOf([
      'def outer():',        // 1, depth 0
      '    def inner():',    // 2, depth 1
      '        value = 1',   // 3, depth 2
      '        return value',// 4
      '    return inner',    // 5, depth 1
    ]);
    // Inside `value = 1` both enclosing declarations are pinned, outermost first.
    expect(stickyScopes(state, 3, 4)).toEqual([
      { line: 1, depth: 0, text: 'def outer():' },
      { line: 2, depth: 1, text: 'def inner():' },
    ]);
    // Inside `return inner` only the outer one encloses it.
    expect(stickyScopes(state, 5, 4)).toEqual([{ line: 1, depth: 0, text: 'def outer():' }]);
  });

  test('does not pin a line to itself, nor a top-level line to anything', () => {
    const state = stateOf(['def outer():', '    value = 1']);
    // Line 1 is the declaration: nothing encloses it.
    expect(stickyScopes(state, 1, 4)).toEqual([]);
    // Line 2 is enclosed by line 1.
    expect(stickyScopes(state, 2, 4)).toEqual([{ line: 1, depth: 0, text: 'def outer():' }]);
  });

  test('skips blank lines and stops at the document start', () => {
    const state = stateOf([
      'class Api:',
      '',
      '    def get(self):',
      '',
      '        return 1',
    ]);
    expect(stickyScopes(state, 5, 4)).toEqual([
      { line: 1, depth: 0, text: 'class Api:' },
      { line: 3, depth: 1, text: 'def get(self):' },
    ]);
  });

  test('caps the pinned stack at the reference default', () => {
    // Twelve nested levels; `maxLineCount` is 5.
    const lines = Array.from({ length: 12 }, (_, depth) => `${'    '.repeat(depth)}level ${depth}`);
    const scopes = stickyScopes(stateOf(lines), 12, 4);
    expect(scopes).toHaveLength(MAX_STICKY_LINES);
    // The stack is built outwards from the caret, so the five *nearest* ancestors
    // are the ones kept — the deepest ones are what the reader is looking at.
    expect(scopes.map((scope) => scope.line)).toEqual([7, 8, 9, 10, 11]);
    // They stay ordered outermost first for display.
    expect(scopes.map((scope) => scope.depth)).toEqual([6, 7, 8, 9, 10]);
  });

  test('reads a two-space file with its own indent unit', () => {
    const state = stateOf(['function a() {', '  if (x) {', '    return 1;', '  }', '}']);
    expect(stickyScopes(state, 3, 2)).toEqual([
      { line: 1, depth: 0, text: 'function a() {' },
      { line: 2, depth: 1, text: 'if (x) {' },
    ]);
  });
});

describe('the sticky scroll preference', () => {
  test('is on by default, as `editor.stickyScroll.enabled` is in the reference', () => {
    expect(DEFAULT_EDITOR_SETTINGS.stickyScroll).toBe(true);
  });

  test('survives a settings round trip and ignores a non-boolean', () => {
    const kept = normalizeUserSettings({ editor: { stickyScroll: false } });
    expect(kept.editor.stickyScroll).toBe(false);
    // A stored string must not flip the flag — the loader only takes booleans.
    const ignored = normalizeUserSettings({ editor: { stickyScroll: 'no' } });
    expect(ignored.editor.stickyScroll).toBe(true);
  });
});
