import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { CHORD_TIMEOUT_MS, createChords } from '../src/composables/useChords';

// A chord is two keypresses where the first one does nothing on its own. VS Code packs
// both into a single number — `Do(first, second) = first | (second << 16)` — and Zen
// mode's binding is `Do(2089, 56)`, which is Ctrl+K then Z. The web shell matches on
// key strings rather than keycodes, so what is worth reimplementing is the behaviour
// rather than the encoding.
//
// The behaviour that actually matters is what happens to keys that are *not* part of a
// chord, because that is where a naive implementation breaks the rest of the keyboard.

const event = (key: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe('chord shortcuts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('runs a binding only when the second key arrives', () => {
    const run = vi.fn();
    const chords = createChords({ k: [{ key: 'z', run }] });

    chords.arm('k');
    expect(chords.armed()).toBe('k');
    expect(run).not.toHaveBeenCalled();

    expect(chords.handle(event('z'))).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    // The prefix is spent: a second Z on its own does nothing.
    expect(chords.armed()).toBeNull();
    expect(chords.handle(event('z'))).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('consumes an unmatched second key instead of letting it act', () => {
    // This is the failure the whole module exists to prevent. Ctrl+K followed by S is
    // Save All, but Ctrl+K followed by W is nothing; if the W fell through, it would
    // close the editor tab — a destructive action triggered by a typo in a chord.
    const run = vi.fn();
    const chords = createChords({ k: [{ key: 'z', run }] });
    chords.arm('k');

    expect(chords.handle(event('w'))).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(chords.armed()).toBeNull();
  });

  test('abandons the prefix when the next key carries a modifier', () => {
    // Ctrl+Shift+P after Ctrl+K is the command palette, not a chord, and must reach it.
    const run = vi.fn();
    const chords = createChords({ k: [{ key: 'z', run }] });
    chords.arm('k');

    expect(chords.handle(event('P', { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(chords.armed()).toBeNull();
  });

  test('pressing the prefix twice re-arms rather than acting', () => {
    const run = vi.fn();
    const chords = createChords({ k: [{ key: 'z', run }, { key: 'k', run }] });
    chords.arm('k');

    expect(chords.handle(event('k'))).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(chords.armed()).toBe('k');
  });

  test('drops an armed prefix after the timeout', () => {
    // Without this a Ctrl+K typed minutes ago would still swallow the next keystroke.
    const run = vi.fn();
    const chords = createChords({ k: [{ key: 'z', run }] });
    chords.arm('k');

    vi.advanceTimersByTime(CHORD_TIMEOUT_MS);
    expect(chords.armed()).toBeNull();
    expect(chords.handle(event('z'))).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  test('ignores everything while nothing is armed', () => {
    const chords = createChords({ k: [{ key: 'z', run: () => {} }] });
    expect(chords.handle(event('z'))).toBe(false);
    expect(chords.handle(event('k', { ctrlKey: true }))).toBe(false);
  });

  test('cancelling clears the prefix', () => {
    const run = vi.fn();
    const chords = createChords({ k: [{ key: 'z', run }] });
    chords.arm('k');
    chords.cancel();

    expect(chords.armed()).toBeNull();
    expect(chords.handle(event('z'))).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  test('an unbound prefix still swallows its second key', () => {
    // A prefix with no bindings behaves like one whose every chord is unbound: the
    // next key is consumed, so an unimplemented chord family cannot corrupt input.
    const chords = createChords({});
    chords.arm('k');
    expect(chords.handle(event('s'))).toBe(true);
    expect(chords.armed()).toBeNull();
  });
});
