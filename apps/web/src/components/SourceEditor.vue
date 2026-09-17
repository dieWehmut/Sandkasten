<script setup lang="ts">
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching } from '@codemirror/language';
import { search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, highlightActiveLine, highlightSpecialChars, keymap, lineNumbers } from '@codemirror/view';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { languageExtensionForRuntime } from '../editor/language';
import { sourceHighlighting } from '../editor/highlight';

const props = withDefaults(defineProps<{
  modelValue: string;
  language?: string;
  disabled?: boolean;
  label?: string;
}>(), {
  language: '',
  disabled: false,
  label: 'Source code',
});

const emit = defineEmits<{ 'update:modelValue': [value: string]; 'update:cursor': [position: { line: number; column: number }] }>();
const editorHost = ref<HTMLElement>();
const editorView = ref<EditorView>();
const languageCompartment = new Compartment();
const editableCompartment = new Compartment();
let applyingExternalValue = false;

function languageExtension(): Extension {
  return languageExtensionForRuntime(props.language) ?? [];
}

function editableExtensions(label: string, disabled: boolean): Extension[] {
  return [
    EditorState.readOnly.of(disabled),
    EditorView.editable.of(!disabled),
    EditorView.contentAttributes.of({
      role: 'textbox',
      'aria-multiline': 'true',
      'aria-label': label,
      'aria-disabled': String(disabled),
      spellcheck: 'false',
    }),
  ];
}

function cursorOf(state: EditorState): { line: number; column: number } {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  return { line: line.number, column: head - line.from + 1 };
}

function editorExtensions(): Extension[] {
  return [
    lineNumbers(),
    highlightSpecialChars(),
    history(),
    bracketMatching(),
    closeBrackets(),
    highlightActiveLine(),
    sourceHighlighting(),
    search(),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    languageCompartment.of(languageExtension()),
    editableCompartment.of(editableExtensions(props.label, props.disabled)),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !applyingExternalValue) emit('update:modelValue', update.state.doc.toString());
      if (update.selectionSet || update.docChanged || update.focusChanged) emit('update:cursor', cursorOf(update.state));
    }),
  ];
}

onMounted(() => {
  if (!editorHost.value) return;
  const state = EditorState.create({ doc: props.modelValue, extensions: editorExtensions() });
  editorView.value = new EditorView({ state, parent: editorHost.value });
  emit('update:cursor', cursorOf(state));
});

watch(() => props.modelValue, (value) => {
  const view = editorView.value;
  if (!view || value === view.state.doc.toString()) return;
  applyingExternalValue = true;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  applyingExternalValue = false;
});

watch(() => props.language, () => {
  editorView.value?.dispatch({ effects: languageCompartment.reconfigure(languageExtension()) });
});

watch(() => [props.disabled, props.label] as const, ([disabled, label]) => {
  editorView.value?.dispatch({
    effects: editableCompartment.reconfigure(editableExtensions(label, disabled)),
  });
});

onBeforeUnmount(() => {
  editorView.value?.destroy();
  editorView.value = undefined;
});

defineExpose({ editorView });
</script>

<template>
  <div class="source-editor" data-testid="source-editor">
    <div ref="editorHost" class="source-editor__surface" />
  </div>
</template>
