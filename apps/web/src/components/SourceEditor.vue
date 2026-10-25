<script setup lang="ts">
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, redoDepth, selectAll, undo, undoDepth } from '@codemirror/commands';
import { bracketMatching, indentUnit } from '@codemirror/language';
import { openSearchPanel, highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, type Extension, type Transaction } from '@codemirror/state';
import { EditorView, highlightActiveLine, highlightSpecialChars, keymap, lineNumbers } from '@codemirror/view';
import { showMinimap } from '@replit/codemirror-minimap';
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { languageExtensionForRuntime } from '../editor/language';
import { sourceCompletion } from '../editor/completion';
import { sourceHighlighting } from '../editor/highlight';
import { indentGuides } from '../editor/indentGuides';
import { FindWidgetPanel } from '../editor/findWidget';
import { editorMenuEntries, type EditorMenuAction } from '../editor/editorMenu';
import type { ContextMenuEntry } from './contextMenu';
import ContextMenu from './ContextMenu.vue';
import { useTranslation } from '../i18n/useTranslation';
import { normalizeUserSettings, type EditorSettings } from '../state/editorSettings';

const props = withDefaults(defineProps<{
  modelValue: string;
  language?: string;
  disabled?: boolean;
  label?: string;
  minimap?: boolean;
  options?: Partial<EditorSettings>;
}>(), {
  language: '',
  disabled: false,
  label: 'Source code',
  minimap: false,
});

const emit = defineEmits<{ 'update:modelValue': [value: string]; 'update:cursor': [position: { line: number; column: number }] }>();
const t = useTranslation();
const editorOptions = computed(() => ({
  ...normalizeUserSettings({ editor: props.options }).editor,
  // Keep the standalone/mobile component's legacy minimap default. The shared
  // settings object, when supplied by the workbench, takes precedence.
  minimap: props.options?.minimap ?? props.minimap,
}));
const editorHost = ref<HTMLElement>();
// A CodeMirror view must stay raw: a reactive proxy would make the state the// commands read differ from the state the view dispatches against.
const editorView = shallowRef<EditorView>();
const languageCompartment = new Compartment();
const editableCompartment = new Compartment();
const minimapCompartment = new Compartment();
const optionsCompartment = new Compartment();
const completionCompartment = new Compartment();
let applyingExternalValue = false;

// Right-click opens the editor's own menu instead of the browser's.
const menuOpen = ref(false);
const menuAt = ref({ x: 0, y: 0 });
const menuEntries = ref<ContextMenuEntry[]>([]);
const clipboardMessage = ref('');
const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

function currentView(): EditorView | undefined {
  return editorView.value;
}

// The reference opens the editor menu from the keyboard too (Shift+F10, or the
// dedicated menu key). It anchors at the caret, falling back to the editor's own
// box when the platform cannot report caret coordinates.
function openEditorMenuAtCaret(): boolean {
  const view = currentView();
  if (!view) return false;
  const head = view.state.selection.main.head;
  const coords = view.coordsAtPos(head);
  const box = editorHost.value?.getBoundingClientRect();
  openEditorMenu({
    clientX: coords?.left ?? box?.left ?? 0,
    clientY: coords?.bottom ?? box?.top ?? 0,
  } as MouseEvent);
  return true;
}

// VS Code keeps the selection when the editor is right-clicked, but CodeMirror
// resets the selection on any mouse press, so keep the secondary press away from
// CodeMirror and let the menu decide where the caret goes.
function onMouseDown(event: MouseEvent): void {
  if (event.button === 2) event.stopPropagation();
}

function openEditorMenu(event: MouseEvent): void {
  const view = currentView();
  if (!view) return;
  // VS Code moves the caret to the click unless it lands inside the selection.
  const at = view.posAtCoords({ x: event.clientX, y: event.clientY });
  const selection = view.state.selection.main;
  if (at != null && (at < selection.from || at > selection.to)) {
    view.dispatch({ selection: { anchor: at } });
  }
  const latest = view.state.selection.main;
  menuEntries.value = editorMenuEntries(t, {
    hasSelection: !latest.empty,
    canPaste: Boolean(globalThis.navigator?.clipboard?.readText),
    canUndo: undoDepth(view.state) > 0,
    canRedo: redoDepth(view.state) > 0,
    modifier: isMac ? 'Cmd' : 'Ctrl',
  });
  menuAt.value = { x: event.clientX, y: event.clientY };
  clipboardMessage.value = '';
  menuOpen.value = true;
  view.focus();
}

async function runEditorMenuAction(id: string): Promise<void> {
  menuOpen.value = false;
  const view = currentView();
  if (!view) return;
  const selection = view.state.selection.main;
  const selected = view.state.sliceDoc(selection.from, selection.to);
  // CodeMirror's history and selection commands take a state target rather than
  // a view, so hand them one bound to this editor.
  const target = { state: view.state, dispatch: (transaction: Transaction) => view.dispatch(transaction) };

  try {
    if (id === 'cut' && selected) {
      await navigator.clipboard.writeText(selected);
      view.dispatch({ changes: { from: selection.from, to: selection.to, insert: '' } });
    } else if (id === 'copy' && selected) {
      await navigator.clipboard.writeText(selected);
    } else if (id === 'paste') {
      const clip = await navigator.clipboard.readText();
      if (clip) view.dispatch(view.state.replaceSelection(clip));
    }
  } catch {
    // The browser can refuse clipboard access; the keyboard shortcut still works.
    clipboardMessage.value = t('editor.clipboardDenied');
  }

  if (id === 'selectAll') selectAll(target);
  else if (id === 'find') openSearchPanel(view);
  else if (id === 'undo') undo(target);
  else if (id === 'redo') redo(target);
  view.focus();
}

function menuAction(id: string): void {
  void runEditorMenuAction(id as EditorMenuAction);
}

// Closing the menu (Escape or a click outside) hands focus back to the editor
// instead of dropping it on the document.
function closeEditorMenu(): void {
  menuOpen.value = false;
  currentView()?.focus();
}

// The minimap mounts its own column inside the editor, so the configuration
// rides in a compartment: toggling it never rebuilds the document or the
// cursors the user is working with.
function minimapExtension(): Extension {
  if (!editorOptions.value.minimap) return [];
  return showMinimap.compute([], () => ({
    create: () => {
      const dom = document.createElement('div');
      dom.className = 'source-editor__minimap';
      return { dom };
    },
    displayText: 'characters',
    showOverlay: 'always',
  }));
}

function languageExtension(): Extension {
  return languageExtensionForRuntime(props.language) ?? [];
}

function completionExtension(): Extension {
  return sourceCompletion(props.language, editorOptions.value.quickSuggestions);
}

function optionsExtensions(): Extension[] {
  const options = editorOptions.value;
  return [
    EditorState.tabSize.of(options.tabSize),
    indentUnit.of(options.insertSpaces ? ' '.repeat(options.tabSize) : '\t'),
    options.wordWrap ? EditorView.lineWrapping : [],
    options.lineNumbers ? lineNumbers() : [],
    // Without a shared preference, retain document-detected guide spacing.
    options.indentGuides ? indentGuides(props.options?.tabSize === undefined ? undefined : options.tabSize) : [],
  ];
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
    optionsCompartment.of(optionsExtensions()),
    highlightSpecialChars(),
    history(),
    bracketMatching(),
    closeBrackets(),
    highlightActiveLine(),
    sourceHighlighting(),
    // VS Code highlights the other occurrences of the selected word.
    highlightSelectionMatches(),
    // The find widget floats over the editor's top-right corner, the way VS
    // Code's does, instead of CodeMirror's default strip inside the editor.
    search({ createPanel: (view) => new FindWidgetPanel(view, t) }),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      indentWithTab,
      // Keyboard access to the editor menu, as the reference offers it.
      { key: 'Shift-F10', run: () => openEditorMenuAtCaret() },
      { key: 'ContextMenu', run: () => openEditorMenuAtCaret() },
    ]),
    languageCompartment.of(languageExtension()),
    completionCompartment.of(completionExtension()),
    minimapCompartment.of(minimapExtension()),
    editableCompartment.of(editableExtensions(props.label, props.disabled)),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !applyingExternalValue) emit('update:modelValue', update.state.doc.toString());
      if (update.selectionSet || update.docChanged || update.focusChanged) emit('update:cursor', cursorOf(update.state));
      // rebuilt after the update that changed it (a reconfigure cannot run from
      // inside the update itself).
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
  editorView.value?.dispatch({ effects: [
    languageCompartment.reconfigure(languageExtension()),
    completionCompartment.reconfigure(completionExtension()),
  ] });
});

watch(editorOptions, (options, previous) => {
  const effects = [optionsCompartment.reconfigure(optionsExtensions())];
  if (options.minimap !== previous.minimap) effects.push(minimapCompartment.reconfigure(minimapExtension()));
  if (options.quickSuggestions !== previous.quickSuggestions) effects.push(completionCompartment.reconfigure(completionExtension()));
  editorView.value?.dispatch({ effects });
}, { deep: true });

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
  <div class="source-editor" data-testid="source-editor" :style="{ '--editor-font-size': `${editorOptions.fontSize}px` }" @mousedown.capture="onMouseDown" @contextmenu.prevent="openEditorMenu">
    <div ref="editorHost" class="source-editor__surface" />
    <p v-if="clipboardMessage" class="source-editor__status" role="alert">{{ clipboardMessage }}</p>
    <ContextMenu
      :open="menuOpen"
      :x="menuAt.x"
      :y="menuAt.y"
      :entries="menuEntries"
      :label="t('editor.contextMenu')"
      @select="menuAction"
      @close="closeEditorMenu"
    />
  </div>
</template>
