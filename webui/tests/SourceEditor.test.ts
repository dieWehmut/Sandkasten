import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { describe, expect, test, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import SourceEditor from '../src/components/SourceEditor.vue';
import { languageExtensionForRuntime } from '../src/editor/language';

describe('SourceEditor', () => {
  test('maps the requested runtimes to CodeMirror language support and keeps unknown runtimes plain text', () => {
    for (const runtime of ['javascript', 'typescript', 'python', 'go', 'rust', 'c', 'cpp', 'c++', 'java', 'json']) {
      expect(languageExtensionForRuntime(runtime), runtime).not.toBeNull();
    }
    expect(languageExtensionForRuntime('future-language')).toBeNull();
  });

  test('edits source through CodeMirror and follows external model updates', async () => {
    const wrapper = mount(SourceEditor, {
      props: {
        modelValue: 'console.log("first")',
        language: 'javascript',
        label: 'Program source',
      },
    });
    const view = wrapper.vm.editorView as EditorView;

    expect(wrapper.get('[role="textbox"]').attributes('aria-label')).toBe('Program source');
    expect(view.state.doc.toString()).toBe('console.log("first")');

    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'console.log("second")' } });
    await nextTick();
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['console.log("second")']);

    await wrapper.setProps({ modelValue: 'console.log("external")' });
    expect(view.state.doc.toString()).toBe('console.log("external")');
  });

  test('updates language and disabled state without recreating the editor, then destroys it on unmount', async () => {
    const destroy = vi.spyOn(EditorView.prototype, 'destroy');
    const wrapper = mount(SourceEditor, {
      props: { modelValue: 'print("ok")', language: 'python', disabled: false },
    });
    const view = wrapper.vm.editorView as EditorView;

    await wrapper.setProps({ language: 'rust', disabled: true });
    expect(wrapper.vm.editorView).toBe(view);
    expect(wrapper.get('[role="textbox"]').attributes('aria-disabled')).toBe('true');

    wrapper.unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
    destroy.mockRestore();
  });
});
