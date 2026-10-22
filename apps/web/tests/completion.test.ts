import { readFileSync } from 'node:fs';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { describe, expect, test, vi } from 'vitest';
import { CompletionContext, currentCompletions, nextSnippetField, setSelectedCompletion, startCompletion, type CompletionResult } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import SourceEditor from '../src/components/SourceEditor.vue';
import { catalogCompletions } from '../src/editor/completionCatalog';
import { documentWordCompletions, runtimeCompletionSource } from '../src/editor/completion';
import { languageExtensionForRuntime } from '../src/editor/language';

function complete(runtime: string, source: string, explicit = false) {
  const state = EditorState.create({ doc: source, extensions: languageExtensionForRuntime(runtime) ?? [] });
  return runtimeCompletionSource(runtime)(new CompletionContext(state, source.length, explicit)) as CompletionResult | null;
}

describe('offline language completion', () => {
  test('provides basic completions for every runtime in the installer catalog', () => {
    const installer = readFileSync('../../werkzeug/installer/languages.sh', 'utf8');
    const runtimes = /LANGS=\(([\s\S]*?)\)/.exec(installer)![1].trim().split(/\s+/);
    expect(runtimes).toHaveLength(58);
    for (const runtime of runtimes) {
      expect(catalogCompletions(runtime).length, runtime).toBeGreaterThan(0);
      expect(complete(runtime, '', true)?.options.length, runtime).toBeGreaterThan(0);
    }
  });

  test('waits for a prefix or explicit invocation and uses the correct replacement range', () => {
    expect(complete('python', '')).toBeNull();
    expect(complete('python', '   ')).toBeNull();
    const result = complete('python', '  pri')!;
    expect(result.from).toBe(2);
    expect(result.options.some(({ label, type }) => label === 'print' && type === 'snippet')).toBe(true);
    expect(complete('unrecognised-dsl', 'pri')).toBeNull();
  });

  test('offers DSL templates, CSS properties, SQL keywords and aliases', () => {
    for (const [runtime, prefix, label] of [
      ['graphviz', 'digr', 'digraph'], ['wdl', 'ta', 'task'], ['typst', '#ta', 'table'],
      ['latex', '\\sec', 'section'], ['qml', 'Rect', 'Rectangle'], ['nextflow', 'pro', 'process'],
      ['mermaid', 'flow', 'flowchart'], ['css', 'background-c', 'background-color'],
      ['sql', 'SEL', 'SELECT'], ['vue3', 'ht', 'html'], ['nextjs', 'inter', 'interface'],
    ]) {
      expect(complete(runtime, prefix)?.options.some((option) => option.label === label), runtime).toBe(true);
    }
    expect(complete('css', 'background-c')!.from).toBe(0);
    expect(complete('typst', '#ta')!.from).toBe(1);
    expect(complete('html', '<di')).toBeNull();
  });

  test('suggests known object members after a dot without unrelated keywords', () => {
    const result = complete('javascript', 'console.')!;
    expect(result.from).toBe(8);
    expect(result.options.some(({ label }) => label === 'log')).toBe(true);
    expect(result.options.some(({ label }) => label === 'function')).toBe(false);
    expect(complete('typescript', 'Math.sq')!.from).toBe(5);
    expect(complete('javascript', 'unknown.')).toBeNull();
  });

  test('suppresses general suggestions in comments, strings and read-only documents', () => {
    expect(complete('javascript', '// con')).toBeNull();
    expect(complete('javascript', '"con')).toBeNull();
    expect(complete('python', '# pri')).toBeNull();
    expect(complete('python', '"pri')).toBeNull();
    const state = EditorState.create({ doc: 'pri', extensions: EditorState.readOnly.of(true) });
    const context = new CompletionContext(state, 3, true);
    expect(runtimeCompletionSource('python')(context)).toBeNull();
    expect(documentWordCompletions(context)).toBeNull();
  });

  test('reuses document words for a custom DSL', () => {
    const source = 'resource customResource {}\ncustomR';
    const state = EditorState.create({ doc: source });
    const result = documentWordCompletions(new CompletionContext(state, source.length, false)) as CompletionResult;
    expect(result.options.some(({ label }) => label === 'customResource')).toBe(true);
  });

  test('inserts DSL snippets, preserves their fields and lets Tab move through them', () => {
    const view = new EditorView({ state: EditorState.create({ doc: 'digr', selection: { anchor: 4 } }), parent: document.body });
    const completion = catalogCompletions('graphviz').find(({ label }) => label === 'digraph')!;
    expect(typeof completion.apply).toBe('function');
    if (typeof completion.apply === 'function') completion.apply(view, completion, 0, 4);
    expect(view.state.doc.toString()).toBe('digraph G {\n  rankdir=LR;\n  A -> B;\n}');
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('G');
    expect(nextSnippetField(view)).toBe(true);
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('LR');
    view.destroy();
  });
});

describe('SourceEditor completion integration', () => {
  test('opens with Ctrl+Space, accepts a snippet with Tab and emits the actual inserted code', async () => {
    const wrapper = mount(SourceEditor, { attachTo: document.body, props: { modelValue: 'pri', language: 'python' } });
    const view = wrapper.vm.editorView as EditorView;
    view.dispatch({ selection: { anchor: 3 } });
    view.focus();
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', ctrlKey: true, bubbles: true }));
    await vi.waitFor(() => expect(currentCompletions(view.state).some(({ label }) => label === 'print')).toBe(true));
    const index = currentCompletions(view.state).findIndex(({ label, type }) => label === 'print' && type?.includes('snippet'));
    view.dispatch({ effects: setSelectedCompletion(index) });
    // Respect the default accidental-keypress protection before accepting.
    await new Promise((resolve) => setTimeout(resolve, 90));
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    await nextTick();
    expect(view.state.doc.toString()).toBe('print(value)');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['print(value)']);
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('value');
    wrapper.unmount();
  });

  test('retains native HTML tag completion and changes language without replacing the view', async () => {
    const wrapper = mount(SourceEditor, { attachTo: document.body, props: { modelValue: '<di', language: 'html' } });
    const view = wrapper.vm.editorView as EditorView;
    view.dispatch({ selection: { anchor: 3 } });
    view.focus();
    startCompletion(view);
    await vi.waitFor(() => expect(currentCompletions(view.state).some(({ label }) => label === 'div')).toBe(true));
    await wrapper.setProps({ language: 'graphviz', modelValue: 'digr' });
    expect(wrapper.vm.editorView).toBe(view);
    view.dispatch({ selection: { anchor: 4 } });
    startCompletion(view);
    await vi.waitFor(() => expect(currentCompletions(view.state).some(({ label }) => label === 'digraph')).toBe(true));
    wrapper.unmount();
  });
});
