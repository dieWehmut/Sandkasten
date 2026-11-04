import { python } from '@codemirror/lang-python';
import { EditorState } from '@codemirror/state';
import { describe, expect, test } from 'vitest';
import { BRACKET_COLORS, bracketMarks, MAX_SCAN, slotFor } from '../src/editor/rainbowBrackets';

function stateOf(doc: string): EditorState {
  // The depth walk reads the syntax tree, so a language has to be mounted —
  // CodeMirror's tree is empty without one.
  return EditorState.create({ doc, extensions: [python()] });
}

/** The slot assigned to the bracket at `offset`, or undefined. */
function slotAt(doc: string, offset: number): number | undefined {
  return bracketMarks(stateOf(doc), 0, doc.length).find((mark) => mark.pos === offset)?.slot;
}

describe('rainbow bracket depth', () => {
  test('gives a top-level pair slot 1, the reference numbering', () => {
    // The reference names its slots `foreground1…6`, so depth 0 is slot 1.
    expect(slotAt('f(1)', 1)).toBe(1);
    expect(slotAt('f(1)', 3)).toBe(1);
  });

  test('steps the slot with each enclosing pair', () => {
    // `((a))` — the inner pair is one level deeper than the outer one.
    const doc = '((a))';
    expect(slotAt(doc, 0)).toBe(1);
    expect(slotAt(doc, 1)).toBe(2);
    expect(slotAt(doc, 3)).toBe(2);
    expect(slotAt(doc, 4)).toBe(1);
  });

  test('counts a chain of different bracket kinds as one pool', () => {
    // `independentColorPoolPerBracketType` defaults to false in the reference, so
    // `({[` nests to depth 2 and 3 rather than restarting per kind.
    const doc = '({[0]})';
    expect(slotAt(doc, 0)).toBe(1);
    expect(slotAt(doc, 1)).toBe(2);
    expect(slotAt(doc, 2)).toBe(3);
    expect(slotAt(doc, 4)).toBe(3);
    expect(slotAt(doc, 5)).toBe(2);
    expect(slotAt(doc, 6)).toBe(1);
  });

  test('wraps the depth into the six-slot pool', () => {
    // Seven levels of nesting: depths 0…6 map to slots 1…6, then back to 1.
    const doc = '('.repeat(7) + 'x' + ')'.repeat(7);
    expect(slotAt(doc, 0)).toBe(1);
    expect(slotAt(doc, 5)).toBe(6);
    expect(slotAt(doc, 6)).toBe(1);
    expect(slotFor(6)).toBe(1);
    expect(slotFor(7)).toBe(2);
    expect(BRACKET_COLORS).toBe(6);
  });

  test('leaves non-bracket characters alone', () => {
    const doc = 'const value = 1;';
    expect(bracketMarks(stateOf(doc), 0, doc.length)).toEqual([]);
  });

  test('only marks the visible range it is asked for', () => {
    // A range covering the tail must not report the earlier brackets.
    const doc = 'f(1)\ng(2)';
    const tail = doc.indexOf('g(2)');
    const marks = bracketMarks(stateOf(doc), tail, doc.length);
    expect(marks.map((mark) => mark.pos)).toEqual([tail + 1, tail + 3]);
  });

  test('skips documents past the scan limit', () => {
    // The guard exists so a huge paste does not pay for the depth walk.
    expect(MAX_SCAN).toBeGreaterThan(100_000);
  });
});
