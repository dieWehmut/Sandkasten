<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { ContextMenuItem, ContextMenuEntry } from './contextMenu';

// A VS Code-shaped context menu: a fixed 13 px widget with rows, a right-aligned
// keybinding column, separators between groups, and arrow-key navigation. It
// clamps itself into the viewport and closes on Escape, on a click outside, or
// after an item is chosen. Reference anchors: `.context-view.fixed { font-size:
// 13px; position: fixed }`, `.monaco-action-bar.vertical { border-radius:
// cornerRadius-large }`, and `.action-label.separator { border-bottom: 1px solid;
// margin: 4px .8em; height: 0 }`.

const props = withDefaults(defineProps<{
  open: boolean;
  x: number;
  y: number;
  entries: readonly ContextMenuEntry[];
  label: string;
}>(), { x: 0, y: 0 });

const emit = defineEmits<{ select: [id: string]; close: [] }>();

const menu = ref<HTMLElement>();
const position = ref({ left: 0, top: 0 });
const active = ref(-1);
// The menu is measured before it is shown, so it never flashes at the pointer.
const placed = ref(false);

const enabledAt = (index: number) => {
  const entry = props.entries[index];
  return entry?.kind === 'item' && !entry.disabled;
};

const itemId = (index: number) => `context-menu-${index}`;

function firstEnabled(from: number, step: 1 | -1): number {
  const total = props.entries.length;
  for (let offset = 0; offset < total; offset++) {
    const index = ((from + step * offset) % total + total) % total;
    if (enabledAt(index)) return index;
  }
  return -1;
}

function move(step: 1 | -1): void {
  const next = firstEnabled(active.value + step, step);
  if (next >= 0) active.value = next;
}

function choose(index: number): void {
  const entry = props.entries[index];
  if (!entry || entry.kind !== 'item' || entry.disabled) return;
  emit('select', entry.id);
}

function onKeydown(event: KeyboardEvent): void {
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape', 'Tab'];
  if (!keys.includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === 'Escape' || event.key === 'Tab') { emit('close'); return; }
  if (event.key === 'Enter' || event.key === ' ') { choose(active.value); return; }
  if (event.key === 'ArrowDown') move(1);
  else if (event.key === 'ArrowUp') move(-1);
  else if (event.key === 'Home') active.value = firstEnabled(0, 1);
  else active.value = firstEnabled(props.entries.length - 1, -1);
}

function onPointerdown(event: PointerEvent): void {
  if (props.open && event.target instanceof Node && !menu.value?.contains(event.target)) emit('close');
}
onMounted(() => document.addEventListener('pointerdown', onPointerdown, true));
onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerdown, true));

async function place(): Promise<void> {
  placed.value = false;
  await nextTick();
  const element = menu.value;
  if (!element) return;
  const margin = 4;
  const box = element.getBoundingClientRect();
  const maxLeft = Math.max(margin, window.innerWidth - box.width - margin);
  const maxTop = Math.max(margin, window.innerHeight - box.height - margin);
  position.value = {
    left: Math.min(Math.max(props.x, margin), maxLeft),
    top: Math.min(Math.max(props.y, margin), maxTop),
  };
  placed.value = true;
}

watch(() => [props.open, props.x, props.y, props.entries] as const, async ([open]) => {
  if (!open) { placed.value = false; return; }
  active.value = firstEnabled(0, 1);
  await place();
  menu.value?.focus();
}, { immediate: true, deep: false });
</script>

<template>
  <div
    v-if="open"
    ref="menu"
    class="context-menu"
    :class="{ 'context-menu--placed': placed }"
    :style="{ left: `${position.left}px`, top: `${position.top}px` }"
    role="menu"
    :aria-label="label"
    :aria-activedescendant="active >= 0 ? itemId(active) : undefined"
    tabindex="-1"
    data-testid="context-menu"
    @keydown="onKeydown"
    @contextmenu.prevent
  >
    <template v-for="(entry, index) in entries" :key="index">
      <div v-if="entry.kind === 'separator'" class="context-menu__separator" role="separator" />
      <button
        v-else
        :id="itemId(index)"
        type="button"
        class="context-menu__item"
        role="menuitem"
        :data-action="`context-menu-${entry.id}`"
        :disabled="entry.disabled"
        :aria-disabled="entry.disabled ? 'true' : undefined"
        :tabindex="index === active ? 0 : -1"
        @pointermove="active = index"
        @click="choose(index)"
      >
        <span class="context-menu__label">{{ entry.label }}</span>
        <kbd v-if="entry.keybinding" class="context-menu__keybinding" aria-hidden="true">{{ entry.keybinding }}</kbd>
      </button>
    </template>
  </div>
</template>