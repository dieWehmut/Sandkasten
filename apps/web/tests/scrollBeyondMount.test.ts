import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, test } from 'vitest';
import { BEYOND_SPACER_CLASS, scrollBeyondLastLine } from '../src/editor/scrollBeyond';

const frames = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))));

function mount(enabled: boolean): EditorView {
  const host = document.createElement('div');
  host.style.height = '200px';
  document.body.appendChild(host);
  return new EditorView({
    state: EditorState.create({
      doc: Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n'),
      extensions: [scrollBeyondLastLine(enabled)],
    }),
    parent: host,
  });
}

describe('the scroll-beyond plugin', () => {
  test('mounts a spacer and measures without throwing', async () => {
    // jsdom reports no layout, so every measurement is 0 and the spacer stays at 0 px.
    // The real geometry is asserted in a browser probe; this pins the wiring, and in
    // particular that the range is reserved by a spacer rather than by the scroller's
    // `padding-bottom` — CodeMirror reads that padding as document padding and
    // re-lays-out around it, which moved the last line instead of extending the range.
    const view = mount(true);
    await frames();
    expect(view.scrollDOM.querySelector(`.${BEYOND_SPACER_CLASS}`)).not.toBeNull();
    expect(view.scrollDOM.style.paddingBottom).toBe('');
    view.destroy();
    expect(view.scrollDOM.querySelector(`.${BEYOND_SPACER_CLASS}`)).toBeNull();
  });

  test('reserves nothing when the preference is off', async () => {
    const view = mount(false);
    await frames();
    expect(view.scrollDOM.querySelector(`.${BEYOND_SPACER_CLASS}`)).toBeNull();
    expect(view.scrollDOM.style.paddingBottom).toBe('');
    view.destroy();
  });
});
