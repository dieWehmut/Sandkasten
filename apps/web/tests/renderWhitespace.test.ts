import { EditorState } from '@codemirror/state';
import { describe, expect, test } from 'vitest';
import {
  DEFAULT_RENDER_WHITESPACE,
  isRenderWhitespaceMode,
  RENDER_WHITESPACE_MODES,
  whitespaceMarks,
  type RenderWhitespaceMode,
} from '../src/editor/renderWhitespace';

function stateOf(doc: string, selection?: { anchor: number; head: number }): EditorState {
  return EditorState.create({ doc, selection });
}

/** The marked offsets, which is what the decorations ultimately cover. */
function positions(doc: string, mode: RenderWhitespaceMode, selection?: { anchor: number; head: number }): number[] {
  const state = stateOf(doc, selection);
  return whitespaceMarks(state, 0, state.doc.length, mode).map((mark) => mark.pos);
}

describe('render whitespace modes', () => {
  test('defaults to `selection`, as the reference does', () => {
    // nls 652: "Render whitespace characters only on selected text."
    expect(DEFAULT_RENDER_WHITESPACE).toBe('selection');
    expect(RENDER_WHITESPACE_MODES).toEqual(['none', 'boundary', 'selection', 'trailing', 'all']);
  });

  test('`none` marks nothing at all', () => {
    expect(positions('  a\t b  ', 'none')).toEqual([]);
  });

  test('`selection` marks only whitespace inside a non-empty selection', () => {
    const doc = '    value = 1';
    // With no selection there is nothing to show.
    expect(positions(doc, 'selection')).toEqual([]);
    // Selecting the leading indentation marks all four spaces.
    expect(positions(doc, 'selection', { anchor: 0, head: 4 })).toEqual([0, 1, 2, 3]);
    // A caret alone is still an empty selection.
    expect(positions(doc, 'selection', { anchor: 4, head: 4 })).toEqual([]);
  });

  test('`all` marks every space and tab', () => {
    // "  a\t b" — offsets: 0,1 spaces; 2 is 'a'; 3 is the tab; 4 is the space.
    expect(positions('  a\t b', 'all')).toEqual([0, 1, 3, 4]);
  });

  test('`trailing` marks only the whitespace at the end of each line', () => {
    // "a  \nb\t\nc" — 1,2 are the trailing spaces; 5 is the trailing tab.
    expect(positions('a  \nb\t\nc', 'trailing')).toEqual([1, 2, 5]);
  });

  test('`boundary` hides single spaces between words but keeps runs', () => {
    // `a b` — the lone space is between words, so it stays hidden.
    expect(positions('a b', 'boundary')).toEqual([]);
    // `a  b` — a run of two is not a single separator, so both show.
    expect(positions('a  b', 'boundary')).toEqual([1, 2]);
    // Leading indentation always shows.
    expect(positions('  a b', 'boundary')).toEqual([0, 1]);
  });

  test('reports tabs separately from spaces so they can be drawn differently', () => {
    const state = stateOf('\ta');
    const marks = whitespaceMarks(state, 0, state.doc.length, 'all');
    expect(marks).toEqual([{ pos: 0, tab: true }]);
    expect(whitespaceMarks(stateOf(' a'), 0, 2, 'all')).toEqual([{ pos: 0, tab: false }]);
  });

  test('recognises the reference mode names and rejects anything else', () => {
    for (const mode of RENDER_WHITESPACE_MODES) expect(isRenderWhitespaceMode(mode)).toBe(true);
    expect(isRenderWhitespaceMode('yes')).toBe(false);
    expect(isRenderWhitespaceMode(undefined)).toBe(false);
  });
});
