import { EditorState } from '@codemirror/state';
import { describe, expect, test } from 'vitest';
import { buildGuides, guideLevels, indentStep, leadingColumns, stepStyle } from '../src/editor/indentGuides';

// Live decoration rendering (and the stripe width) is measured against the built
// distribution in the browser audit; what is covered here is the pass itself: the
// levels, the step and the set it produces for a document.
describe('indent guide computation', () => {
  test('counts leading columns for spaces, tabs and mixes', () => {
    expect(leadingColumns('    value', 4)).toBe(4);
    expect(leadingColumns('\tvalue', 4)).toBe(4);
    expect(leadingColumns('  \tvalue', 4)).toBe(6);
    expect(leadingColumns('value', 4)).toBe(0);
    expect(leadingColumns('', 4)).toBe(0);
  });

  test('turns the indentation into guide levels', () => {
    expect(guideLevels('def main():', 4)).toBe(0);
    expect(guideLevels('    if value:', 4)).toBe(1);
    expect(guideLevels('        return 1', 4)).toBe(2);
    expect(guideLevels('  two', 2)).toBe(1);
    // A blank line shows no guides of its own; the pass lets it inherit the block.
    expect(guideLevels('   ', 4)).toBe(-1);
    expect(guideLevels('', 4)).toBe(-1);
  });

  test('takes the step from the document, not from the language default', () => {
    // CodeMirror reports 2 for Python; the file itself uses four spaces.
    expect(indentStep('def main():\n    return 1\n')).toBe(4);
    expect(indentStep('function a() {\n  return 1;\n}\n')).toBe(2);
    expect(stepStyle('def main():\n    return 1\n')).toBe('--indent-step: 4ch');
  });

  test('decorates every nested line and runs the guides through blank lines', () => {
    const source = ['def main():', '    value = 1', '    if value:', '        print(value)', '', '    return value', ''].join('\n');
    const state = EditorState.create({ doc: source });
    const set = buildGuides(state);
    // Lines 2, 3, 4, the blank line that continues the inner block, line 6 and the
    // trailing blank line; line 1 is not nested.
    expect(set.size).toBe(6);
    const depths: string[] = [];
    for (const cursor = set.iter(); cursor.value; cursor.next()) {
      depths.push(cursor.value.spec.class?.split(' ').at(-1) ?? '');
    }
    expect(depths).toEqual([
      'cm-indent-guides-1', 'cm-indent-guides-1', 'cm-indent-guides-2',
      'cm-indent-guides-2', 'cm-indent-guides-1', 'cm-indent-guides-1',
    ]);
  });
});