import { describe, expect, test } from 'vitest';
import { FOLD_PLACEHOLDER, foldingExtensions, foldMarker } from '../src/editor/folding';

// The live behaviour — the chevron hidden until the margin is hovered, the fold
// collapsing lines, the marker staying on screen while folded — is measured
// against the built distribution in the browser audit. What is covered here is the
// marker itself and the shape of the extension list.
describe('editor folding', () => {
  test('draws the reference chevron for each state', () => {
    const open = foldMarker(true);
    expect(open.className).toBe('cm-foldMarker cm-foldMarker--open');
    expect(open.getAttribute('aria-hidden')).toBe('true');
    const openPath = open.querySelector('path');
    // `codicon-folding-expanded` is a chevron-down.
    expect(openPath?.getAttribute('d')).toBe('m6 9 6 6 6-6');

    const closed = foldMarker(false);
    expect(closed.className).toBe('cm-foldMarker cm-foldMarker--closed');
    // `codicon-folding-collapsed` is a chevron-right.
    expect(closed.querySelector('path')?.getAttribute('d')).toBe('m9 18 6-6-6-6');

    // The glyph is the size the reference's `font-size: 140%` codicon lands at,
    // stroked in `currentColor` so it follows the gutter's role colour.
    const svg = open.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('12');
    expect(svg?.getAttribute('height')).toBe('12');
    expect(svg?.getAttribute('stroke')).toBe('currentColor');
    expect(svg?.getAttribute('fill')).toBe('none');
  });

  test('offers the chevron column only when there is a margin for it', () => {
    // Folding and its keys are always present; the gutter follows the line numbers.
    const withGutter = foldingExtensions({ gutter: true });
    const without = foldingExtensions({ gutter: false });
    expect(withGutter).toHaveLength(3);
    expect(without).toHaveLength(3);
    // The third slot is the gutter: an extension when the margin exists, an empty
    // slot when it does not, so the editor still folds from the keyboard.
    expect(without[2]).toEqual([]);
    expect(withGutter[2]).not.toEqual([]);
  });

  test('marks a folded range with the reference glyph', () => {
    // `\22ef` — the midline ellipsis the reference draws after the first line —
    // rather than CodeMirror's baseline `…`.
    expect(FOLD_PLACEHOLDER).toBe('\u22ef');
    expect(FOLD_PLACEHOLDER).not.toBe('\u2026');
  });
});
