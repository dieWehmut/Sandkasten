// Chord ("two-key") shortcuts, as the reference implements them.
//
// VS Code encodes a chord as one number: `Do(first, second) = first | (second << 16)`,
// so the whole binding is a single `primary` value rather than a nested structure.
// The editor menu reads it back as "Ctrl+K Z" — two keypresses, the first of which
// does nothing on its own and arms the next one.
//
// This module reproduces the *behaviour* without the numeric encoding, because the
// web shell already matches on `KeyboardEvent.key` strings rather than keycodes. The
// part worth copying carefully is not the packing but what a chord does to the
// keyboard: while the first key is armed, the second key must be consumed even when it
// matches no chord, and any unrelated key must cancel the prefix instead of acting.

/** How long an armed prefix waits before it is dropped, in milliseconds. */
export const CHORD_TIMEOUT_MS = 1000;

export interface ChordBinding {
  /** The second key, lower-cased, with no modifiers of its own. */
  readonly key: string;
  /** What to run once the full chord is pressed. */
  readonly run: () => void;
}

export interface ChordController {
  /** Arms `prefix`, replacing any prefix already waiting. */
  arm(prefix: string): void;
  /** Clears any armed prefix. */
  cancel(): void;
  /** The armed prefix, or null. */
  readonly armed: () => string | null;
  /**
   * Handles the second key of a chord.
   *
   * Returns true when the event was consumed, which includes the case where the key
   * matches no binding: while a prefix is armed, the next chord-less key must not fall
   * through to the single-key shortcuts, or `Ctrl+K` followed by `S` would save the
   * file instead of doing nothing. Also returns true for the prefix key itself, so
   * pressing it twice arms it again without acting.
   */
  handle(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): boolean;
}

export function createChords(bindings: Record<string, readonly ChordBinding[]> = {}): ChordController {
  let pending: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pending = null;
  };

  const arm = (prefix: string): void => {
    clear();
    pending = prefix;
    timer = setTimeout(clear, CHORD_TIMEOUT_MS);
    // Node's timers keep the process alive; a browser ignores this, but the unit
    // tests do not, so it is unref'd when that is available.
    (timer as unknown as { unref?: () => void }).unref?.();
  };

  const handle = (event: {
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
  }): boolean => {
    if (pending === null) return false;
    // The second key of a chord carries no modifiers in the reference's own bindings
    // (`Ctrl+K Z` is Ctrl+K then a plain Z), so a modifier here means the user started
    // a different command and the prefix is abandoned unreserved.
    if (event.ctrlKey || event.metaKey || event.altKey) {
      clear();
      return false;
    }
    const key = event.key.toLowerCase();
    const armedPrefix = pending;
    // Consume the prefix key itself so a repeated press re-arms rather than acts.
    if (key === armedPrefix) {
      arm(armedPrefix);
      return true;
    }
    clear();
    const match = (bindings[armedPrefix] ?? []).find((binding) => binding.key === key);
    if (match) match.run();
    // Consumed either way: an unmatched key after a prefix does nothing rather than
    // falling through to the single-key shortcut it would otherwise trigger.
    return true;
  };

  return { arm, cancel: clear, armed: () => pending, handle };
}
