import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import SourceEditor from '../src/components/SourceEditor.vue';

const SETTINGS_STORAGE_KEY = 'sandkasten-user-settings-v1';
function mountWithWordWrap(wordWrap: boolean) {
  return mount(SourceEditor, {
    props: { modelValue: 'a\nb\n', language: 'python', options: { wordWrap } },
    attachTo: document.body,
  });
}

// Word wrap used to be a no-op. The compartment swapped `white-space` to
// `pre-wrap`, but `.cm-content` stays at `min-width: max-content` so the content
// layer was always as wide as the longest line and the scroller just scrolled.
// The wrap class CodeMirror uses — `cm-lineWrapping` — carries the whitespace
// rules *and* is the hook that relaxes that width; `.cm-lineWrapping .cm-content`
// never matched, because `contentAttributes` puts the class on `.cm-content`
// itself, so the width was never relaxed.
describe('word wrap', () => {
  test('adds the wrapping class to the content layer only when enabled', () => {
    const wrapped = mountWithWordWrap(true);
    expect(wrapped.element.querySelector('.cm-content')?.classList.contains('cm-lineWrapping')).toBe(true);
    wrapped.unmount();

    const plain = mountWithWordWrap(false);
    expect(plain.element.querySelector('.cm-content')?.classList.contains('cm-lineWrapping')).toBe(false);
    // The unwrapped editor pins the whitespace explicitly, so the switch is
    // reversible in both directions within one compartment.
    expect(plain.element.querySelector('.cm-content')?.getAttribute('style')).toContain('white-space: pre');
    plain.unmount();
  });
});
