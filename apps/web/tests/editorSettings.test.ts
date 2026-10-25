import { mount } from '@vue/test-utils';
import { describe, expect, test, vi } from 'vitest';
import { closeCompletion, currentCompletions, startCompletion } from '@codemirror/autocomplete';
import { undo } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import SourceEditor from '../src/components/SourceEditor.vue';

function pressTab(view: EditorView) {
  view.focus();
  view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
}

describe('SourceEditor live preferences', () => {
  test('applies font size, wrapping, gutters, minimap and guides without losing the view, selection or undo', async () => {
    const source = 'if True:\n    print("hello")';
    const wrapper = mount(SourceEditor, { attachTo: document.body, props: {
      modelValue: source, language: 'python', options: { fontSize: 18, wordWrap: true, lineNumbers: false, minimap: true, indentGuides: false },
    } });
    const view = wrapper.vm.editorView as EditorView;
    expect(wrapper.get('[data-testid="source-editor"]').attributes('style')).toContain('--editor-font-size: 18px');
    expect(view.contentDOM.style.whiteSpace).toBe('pre-wrap');
    expect(wrapper.find('.cm-lineNumbers').exists()).toBe(false);
    expect(wrapper.find('.cm-minimap-gutter').exists()).toBe(true);
    expect(wrapper.find('.cm-indent-guides').exists()).toBe(false);

    view.dispatch({ changes: { from: view.state.doc.length, insert: '\n# change' }, selection: { anchor: 5 } });
    const edited = view.state.doc.toString();
    await wrapper.setProps({ options: { fontSize: 12, wordWrap: false, lineNumbers: true, minimap: false, indentGuides: true, tabSize: 2 } });
    expect(wrapper.vm.editorView).toBe(view);
    expect(view.state.doc.toString()).toBe(edited);
    expect(view.state.selection.main.head).toBe(5);
    expect(view.contentDOM.style.whiteSpace).toBe('pre');
    expect(wrapper.find('.cm-lineNumbers').exists()).toBe(true);
    expect(wrapper.find('.cm-minimap-gutter').exists()).toBe(false);
    expect(wrapper.find('.cm-indent-guides-2').exists()).toBe(true);
    expect(view.contentDOM.style.getPropertyValue('--indent-step')).toBe('2ch');
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
    wrapper.unmount();
  });

  test('Tab inserts the configured number of spaces or a real tab after changing preferences', async () => {
    const wrapper = mount(SourceEditor, { attachTo: document.body, props: {
      modelValue: '', language: '', options: { tabSize: 3, insertSpaces: true },
    } });
    const view = wrapper.vm.editorView as EditorView;
    expect(view.state.tabSize).toBe(3);
    expect(view.state.facet(indentUnit)).toBe('   ');
    pressTab(view);
    expect(view.state.doc.toString()).toBe('   ');

    await wrapper.setProps({ options: { tabSize: 8, insertSpaces: false } });
    expect(view.state.tabSize).toBe(8);
    expect(view.state.facet(indentUnit)).toBe('\t');
    pressTab(view);
    // indentWithTab re-indents the line from its start, which is what VS Code
    // does too, so the tab lands before the spaces rather than at the caret.
    expect(view.state.doc.toString()).toBe('\t   ');
    expect(view.contentDOM.style.getPropertyValue('--indent-step')).toBe('8ch');
    wrapper.unmount();
  });

  test('quick suggestions switches typing activation while keeping explicit Ctrl+Space assistance', async () => {
    const wrapper = mount(SourceEditor, { attachTo: document.body, props: {
      modelValue: '', language: 'python', options: { quickSuggestions: false },
    } });
    const view = wrapper.vm.editorView as EditorView;
    view.focus();
    view.dispatch({ changes: { from: 0, insert: 'pri' }, selection: { anchor: 3 }, userEvent: 'input.type' });
    await new Promise((resolve) => setTimeout(resolve, 160));
    expect(currentCompletions(view.state)).toHaveLength(0);
    startCompletion(view);
    await vi.waitFor(() => expect(currentCompletions(view.state).some(({ label }) => label === 'print')).toBe(true));
    closeCompletion(view);

    await wrapper.setProps({ options: { quickSuggestions: true } });
    view.dispatch({ changes: { from: 0, to: 3, insert: 'ra' }, selection: { anchor: 2 }, userEvent: 'input.type' });
    await vi.waitFor(() => expect(currentCompletions(view.state).some(({ label }) => label === 'range')).toBe(true));
    wrapper.unmount();
  });

  test('shared minimap preferences override the legacy prop, which remains the fallback', async () => {
    const wrapper = mount(SourceEditor, { props: { modelValue: 'x', minimap: true, options: { minimap: false } } });
    expect(wrapper.find('.cm-minimap-gutter').exists()).toBe(false);
    await wrapper.setProps({ options: {} });
    expect(wrapper.find('.cm-minimap-gutter').exists()).toBe(true);
    wrapper.unmount();
  });
});
