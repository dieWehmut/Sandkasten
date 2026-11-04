import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import SourceEditor from '../src/components/SourceEditor.vue';

// `editor.css` paints `.cm-activeLineGutter` with the reference's
// `editorLineNumber-activeForeground`, but CodeMirror only adds that class when
// `highlightActiveLineGutter()` is in the extension list. It was missing, so the
// rule styled an element that never existed and the line the caret sits on looked
// like every other line. These tests hold the extension in place.
describe('active line gutter', () => {
  test('marks the line the caret sits on, and only that one', async () => {
    const wrapper = mount(SourceEditor, {
      props: { modelValue: 'alpha\nbeta\ngamma\n', language: 'python' },
      attachTo: document.body,
    });
    const view = wrapper.vm.editorView as import('@codemirror/view').EditorView;
    const marked = () => [...wrapper.element.querySelectorAll('.cm-lineNumbers .cm-gutterElement.cm-activeLineGutter')]
      .map((node) => node.textContent?.trim());

    expect(marked()).toEqual(['1']);

    // Line 3 starts after "alpha\n" and "beta\n".
    view.dispatch({ selection: { anchor: 'alpha\nbeta\n'.length + 1 } });
    await wrapper.vm.$nextTick();
    expect(marked()).toEqual(['3']);

    wrapper.unmount();
  });

  test('keeps the line fill on the active line too', async () => {
    const wrapper = mount(SourceEditor, {
      props: { modelValue: 'alpha\nbeta\n', language: 'python' },
      attachTo: document.body,
    });
    // The same extension pair drives `.cm-activeLine` and `.cm-activeLineGutter`,
    // so both must be present together. Every gutter marks the active line — the
    // fold column carries the class too — so the count is checked per column.
    expect(wrapper.element.querySelectorAll('.cm-activeLine').length).toBe(1);
    expect(wrapper.element.querySelectorAll('.cm-lineNumbers .cm-activeLineGutter').length).toBe(1);
    expect(wrapper.element.querySelectorAll('.cm-foldGutter .cm-activeLineGutter').length).toBe(1);
    wrapper.unmount();
  });
});
