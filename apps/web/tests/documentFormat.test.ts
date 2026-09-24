import { describe, expect, test } from 'vitest';
import {
  DEFAULT_INDENTATION,
  SOURCE_ENCODING,
  detectIndentation,
  detectLineEnding,
} from '../src/editor/documentFormat';

describe('document formatting facts', () => {
  test('learns the indent unit from the indented lines', () => {
    // The scratch program is four-space Python, and the widest candidate that
    // every indented line divides evenly is what the status bar reports.
    expect(detectIndentation('def main():\n    print("hi")\n')).toEqual({ kind: 'spaces', size: 4 });
    expect(detectIndentation('if (a) {\n  run();\n}\n')).toEqual({ kind: 'spaces', size: 2 });
    expect(detectIndentation('a\n\tb\n')).toEqual({ kind: 'tabs', size: 4 });
    expect(detectIndentation('a\n        b\n')).toEqual({ kind: 'spaces', size: 8 });
    // A nested four-space document must not be reported as two-space just
    // because every line is even.
    expect(detectIndentation('a\n    b\n        c\n')).toEqual({ kind: 'spaces', size: 4 });
  });

  test('keeps the default when the document has nothing to learn from', () => {
    expect(detectIndentation('print("hi")\n')).toEqual(DEFAULT_INDENTATION);
    expect(detectIndentation('')).toEqual(DEFAULT_INDENTATION);
    expect(detectIndentation('\n\n   \n')).toEqual(DEFAULT_INDENTATION);
    expect(DEFAULT_INDENTATION).toEqual({ kind: 'spaces', size: 4 });
    expect(SOURCE_ENCODING).toBe('UTF-8');
  });

  test('reports the line ending the document mostly uses', () => {
    expect(detectLineEnding('a\nb\n')).toBe('LF');
    expect(detectLineEnding('a\r\nb\r\n')).toBe('CRLF');
    expect(detectLineEnding('print("hi")')).toBe('LF');
    expect(detectLineEnding('')).toBe('LF');
    // A stray carriage return cannot outvote the rest of the document.
    expect(detectLineEnding('a\nb\nc\r\n')).toBe('LF');
    expect(detectLineEnding('a\r\nb\r\nc\n')).toBe('CRLF');
  });
});