<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import ContextMenu from '../ContextMenu.vue';
import type { ContextMenuEntry } from '../contextMenu';
import type { TerminalClipboardAction, TerminalController, TerminalEntry, TerminalSuggestion } from '../../composables/useTerminal';
import { TERMINAL_FONT_SIZE } from '../../composables/useTerminal';
import { useTranslation } from '../../i18n/useTranslation';

const props = defineProps<{ controller: TerminalController; session: TerminalEntry; active: boolean }>();
const t = useTranslation();
const container = ref<HTMLElement>();
let observer: ResizeObserver | undefined;

// A command the shell reports about itself has no file behind it, and the strip
// says which kind it is offering rather than leaving the difference to the name.
const shellSource = computed(() => {
  const family = props.controller.profiles.value
    .find((profile) => profile.id === props.controller.activeProfileId.value)?.family;
  return family === 'powershell' ? t('terminal.source.cmdlet') : t('terminal.source.builtin');
});
function suggestionTitle(suggestion: TerminalSuggestion): string {
  const base = `${t('terminal.complete')} ${suggestion.label}`;
  return suggestion.source === 'shell' ? `${base} · ${shellSource.value}` : base;
}

// The right-click menu, the same widget the editor uses: copy, paste, select all
// and clear, with copy disabled while nothing is selected. A terminal that can only
// be driven by keys is awkward on a mouse-driven desktop. The entries are built when
// the menu opens: whether something is selected is a fact about the buffer, not a
// reactive value the template could watch.
const menuOpen = ref(false);
const menuAt = ref({ x: 0, y: 0 });
const menuEntries = ref<ContextMenuEntry[]>([]);

function buildMenuEntries(): ContextMenuEntry[] {
  return [
    { kind: 'item', id: 'copy', label: t('terminal.menu.copy'), keybinding: 'Ctrl+Shift+C', disabled: !props.controller.hasSelection(props.session.id) },
    { kind: 'item', id: 'paste', label: t('terminal.menu.paste'), keybinding: 'Ctrl+Shift+V' },
    { kind: 'item', id: 'select-all', label: t('terminal.menu.selectAll'), keybinding: 'Ctrl+Shift+A' },
    { kind: 'separator' },
    { kind: 'item', id: 'find', label: t('terminal.menu.find'), keybinding: 'Ctrl+Shift+F' },
    { kind: 'item', id: 'zoom-in', label: t('terminal.menu.zoomIn'), keybinding: 'Ctrl+=' },
    { kind: 'item', id: 'zoom-out', label: t('terminal.menu.zoomOut'), keybinding: 'Ctrl+-' },
    { kind: 'item', id: 'zoom-reset', label: t('terminal.menu.zoomReset'), keybinding: 'Ctrl+0' },
    { kind: 'separator' },
    { kind: 'item', id: 'clear', label: t('terminal.menu.clear') },
  ];
}

function openMenu(event: MouseEvent): void {
  props.controller.select(props.session.id);
  menuEntries.value = buildMenuEntries();
  menuAt.value = { x: event.clientX, y: event.clientY };
  menuOpen.value = true;
}
function runMenuItem(id: string): void {
  menuOpen.value = false;
  if (id === 'zoom-in') { props.controller.zoom(1); return; }
  if (id === 'zoom-out') { props.controller.zoom(-1); return; }
  if (id === 'zoom-reset') { props.controller.zoom(TERMINAL_FONT_SIZE.default - props.controller.fontSize.value); return; }
  if (id === 'find') { props.controller.openSearch(); return; }
  void props.controller.clipboard(id as TerminalClipboardAction, props.session.id);
}

// The find bar searches the scrollback through the terminal's own buffer: it shows
// where the current match sits among them, walks them with the arrows, and scrolls
// the terminal to the one it picked.
const findQuery = ref('');
const findField = ref<HTMLInputElement>();
const findCount = computed(() => {
  const { index, count, sessionId } = props.controller.searchResults.value;
  if (sessionId !== props.session.id) return '';
  if (!findQuery.value.trim()) return '';
  return count ? `${index}/${count}` : t('terminal.findNone');
});
watch(() => props.controller.searchOpen.value, async (open) => {
  if (!open) { findQuery.value = ''; return; }
  await nextTick();
  findField.value?.focus();
});
function search(backwards = false): void {
  props.controller.findSearch(findQuery.value, backwards);
}
function closeFind(): void {
  props.controller.closeSearch();
  props.controller.focus();
}

function labelInput(): void {
  container.value?.querySelector('textarea')?.setAttribute('aria-label', `${t('terminal.input')}: ${props.session.title}`);
}
// Selecting the session focuses its shell, which is right for a click anywhere in
// the pane except the find bar: that one hands the keyboard back to the terminal and
// the field would never see a keystroke.
function onPointerDown(event: PointerEvent): void {
  if (event.target instanceof Element && event.target.closest('[data-testid="terminal-find"]')) return;
  props.controller.select(props.session.id);
}
function onFocusIn(event: FocusEvent): void {
  if (event.target instanceof Element && event.target.closest('[data-testid="terminal-find"]')) return;
  props.controller.select(props.session.id);
}
onMounted(() => {
  if (!container.value) return;
  props.controller.mount(props.session.id, container.value);
  labelInput();
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => props.controller.fit(props.session.id));
    observer.observe(container.value);
  }
});
watch(() => t('terminal.input'), labelInput);
onBeforeUnmount(() => { observer?.disconnect(); props.controller.unmount(props.session.id); });
</script>

<template>
  <section
    class="terminal-pane" :class="{ 'terminal-pane--active': active }"
    data-testid="terminal-pane" :data-session-id="session.id" :data-active="active"
    :style="{ '--terminal-font-size': `${controller.fontSize.value}px` }"
    :aria-label="session.title" @focusin="onFocusIn" @pointerdown="onPointerDown"
    @contextmenu.prevent="openMenu($event)"
    @mousedown.middle.prevent="controller.clipboard('paste-selection', session.id)"
  >
    <div ref="container" class="terminal-pane__viewport" />
    <ContextMenu
      :open="menuOpen" :x="menuAt.x" :y="menuAt.y" :entries="menuEntries" :label="t('terminal.menu')"
      @select="runMenuItem" @close="menuOpen = false"
    />
    <div
      v-if="active && controller.searchOpen.value" class="terminal-find" data-testid="terminal-find"
      role="search" :aria-label="t('terminal.find')"
    >
      <input
        ref="findField" v-model="findQuery" type="search" class="terminal-find__input"
        data-testid="terminal-find-input" :placeholder="t('terminal.find')" :aria-label="t('terminal.find')"
        @input="search()"
        @keydown.enter.exact.prevent="search()"
        @keydown.shift.enter.prevent="search(true)"
        @keydown.esc.prevent="closeFind()"
      >
      <span v-if="findCount" class="terminal-find__count" data-testid="terminal-find-count">{{ findCount }}</span>
      <button
        type="button" class="terminal-find__button" data-action="terminal-find-previous"
        :title="t('terminal.findPrevious')" :aria-label="t('terminal.findPrevious')" @click="search(true)"
      >↑</button>
      <button
        type="button" class="terminal-find__button" data-action="terminal-find-next"
        :title="t('terminal.findNext')" :aria-label="t('terminal.findNext')" @click="search()"
      >↓</button>
      <button
        type="button" class="terminal-find__button" data-action="terminal-find-close"
        :title="t('terminal.findClose')" :aria-label="t('terminal.findClose')" @click="closeFind()"
      >✕</button>
    </div>
    <!-- The shell the user is typing in can run these; the prefix model only
         suggests, it never inserts anything on its own. -->
    <div
      v-if="active && controller.suggestions.value.length" class="terminal-suggestions"
      data-testid="terminal-suggestions" role="listbox" :aria-label="t('terminal.suggestions')"
      :title="t('terminal.suggestionsHint')"
    >
      <button
        v-for="suggestion in controller.suggestions.value" :key="suggestion.value" type="button" role="option"
        data-testid="terminal-suggestion" :data-command="suggestion.label" :data-source="suggestion.source"
        class="terminal-suggestions__item" :class="{ 'terminal-suggestions__item--shell': suggestion.source === 'shell' }"
        :title="suggestionTitle(suggestion)"
        @pointerdown.prevent @click="controller.complete(suggestion)"
      >{{ suggestion.label }}</button>
    </div>
    <div v-if="session.exitCode !== undefined" class="terminal-pane__exit" role="status">
      {{ t('terminal.exited') }} {{ session.exitCode }}
    </div>
  </section>
</template>
