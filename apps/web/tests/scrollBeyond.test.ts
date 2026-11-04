import { describe, expect, test } from 'vitest';
import { DEFAULT_EDITOR_SETTINGS, normalizeUserSettings } from '../src/state/editorSettings';

// The range arithmetic itself has no pure function to unit-test any more, and that
// is deliberate. `beyondSpace` computed the trailing space from
// `view.contentHeight`, and that value disagrees with the DOM: for a six-line file
// it reports 166 px while the last line's top sits 117 px down, so the derived
// offset overshot by 28 px and scrolled the last line past the top edge. The plugin
// now measures the last line's real position instead, which jsdom cannot simulate
// because it reports no layout. The geometry is asserted in a browser probe — where
// `scrollTop` reaches exactly the last line's offset and that line lands at the top
// of the port with `lastLineTopAtBottom: 0` — and the wiring is pinned in
// `scrollBeyondMount.test.ts`.

describe('the scroll-beyond preference', () => {
  test('is on by default and survives the settings round trip', () => {
    // `editor.scrollBeyondLastLine` registers in the reference as
    // `new Ra(120, "scrollBeyondLastLine", !0, …)`, so `true` is its shipped default.
    expect(DEFAULT_EDITOR_SETTINGS.scrollBeyondLastLine).toBe(true);
    expect(normalizeUserSettings({ editor: { scrollBeyondLastLine: false } }).editor.scrollBeyondLastLine).toBe(false);
  });
});
