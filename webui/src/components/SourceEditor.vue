<script setup lang="ts">
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, highlightActiveLine, highlightSpecialChars, keymap, lineNumbers } from '@codemirror/view';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { languageExtensionForRuntime } from '../editor/language';

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

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const editorHost = ref<HTMLElement>();
const editorView = ref<EditorView>();
const languageCompartment = new Compartment();
const editableCompartment = new Compartment();
let applyingExternalValue = false;

function languageExtension(): Extension {
  return languageExtensionForRuntime(props.language) ?? [];
}

function editorExtensions(): Extension[] {
  return [
    lineNumbers(),
    highlightSpecialChars(),
    history(),
    bracketMatching(),
    closeBrackets(),
    highlightActiveLine(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    search(),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    languageCompartment.of(languageExtension()),
    editableCompartment.of([
      EditorState.readOnly.of(props.disabled),
      EditorView.editable.of(!props.disabled),
      EditorView.contentAttributes.of({
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': props.label,
        'aria-disabled': String(props.disabled),
        spellcheck: 'false',
      }),
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !applyingExternalValue) emit('update:modelValue', update.state.doc.toString());
    }),
  ];
}

onMounted(() => {
  if (!editorHost.value) return;
  editorView.value = new EditorView({
    state: EditorState.create({ doc: props.modelValue, extensions: editorExtensions() }),
    parent: editorHost.value,
  });
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

watch(() => props.disabled, (disabled) => {
  editorView.value?.dispatch({
    effects: editableCompartment.reconfigure([
      EditorState.readOnly.of(disabled),
      EditorView.editable.of(!disabled),
      EditorView.contentAttributes.of({
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': props.label,
        'aria-disabled': String(disabled),
        spellcheck: 'false',
      }),
    ]),
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

<style scoped>
.source-editor { min-width: 0; min-height: 18rem; height: 100%; overflow: hidden; }
.source-editor__surface { min-height: 18rem; height: 100%; }
.source-editor :deep(.cm-editor) { height: 100%; min-height: 18rem; }
.source-editor :deep(.cm-scroller) { overflow: auto; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
</style>
