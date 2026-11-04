<script setup lang="ts">
// A themed drop-down, for the places the reference shows a themeable list instead
// of the operating system's own select popup.
//
// The native `<select>` popup is drawn by the browser and cannot be styled — on
// Windows it arrives as a white sheet with a blue highlight, which is what made
// the execution-backend picker look out of place in a dark window. This renders the
// same value with a listbox the app owns.
//
// Measured from the reference: the closed control is
// `.monaco-select-box { cursor: pointer; min-width: 100px; min-height: 24px;
//  padding: 2px 23px 2px 8px; font-size: 11px;
//  border-radius: var(--vscode-cornerRadius-small) }` with a chevron in the right
// padding, and the open list is a `.monaco-list` row set with
// `.quick-input-list .monaco-list-row { border-radius: 3px }`.

import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { Check, ChevronDown } from '@lucide/vue';
import type { DropdownOption } from './dropdownOptions';

const props = withDefaults(defineProps<{
  modelValue: string;
  options: readonly DropdownOption[];
  label: string;
  disabled?: boolean;
  /** Rendered before the label when the caller does not supply its own. */
  showLabel?: boolean;
}>(), { showLabel: false });

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const open = ref(false);
const activeIndex = ref(-1);
const root = ref<HTMLElement>();
const list = ref<HTMLElement>();

const selectedIndex = computed(() => props.options.findIndex((option) => option.value === props.modelValue));
// A list can carry one placeholder row for its empty state — the runtime picker
// uses a disabled "no runtimes available" option — and in that state the caller
// still owns its previous value, so nothing matches and the value span rendered
// blank. A blank trigger looks like a broken control rather than a deliberate
// empty state, so fall back to the placeholder row, but only when it is disabled:
// that keeps a genuine "nothing chosen yet" list showing nothing.
const selectedLabel = computed(() => {
  const matched = props.options[selectedIndex.value];
  if (matched) return matched.label;
  const placeholder = props.options.length === 1 ? props.options[0] : undefined;
  return placeholder?.disabled ? placeholder.label : '';
});

function enabledIndex(from: number, step: number): number {
  const count = props.options.length;
  for (let offset = 1; offset <= count; offset += 1) {
    const index = (from + step * offset + count * count) % count;
    if (!props.options[index]?.disabled) return index;
  }
  return Math.max(0, selectedIndex.value);
}

async function show(initial?: number): Promise<void> {
  if (props.disabled) return;
  open.value = true;
  activeIndex.value = initial ?? (selectedIndex.value >= 0 ? selectedIndex.value : enabledIndex(-1, 1));
  await nextTick();
  // Focus the list itself, otherwise the arrow keys and Escape never reach it and
  // the key press falls through to whatever the page behind is listening for.
  list.value?.focus();
  list.value?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
}

function close(): void {
  open.value = false;
  activeIndex.value = -1;
}

function choose(index: number): void {
  const option = props.options[index];
  if (!option || option.disabled) return;
  if (option.value !== props.modelValue) emit('update:modelValue', option.value);
  close();
  root.value?.querySelector<HTMLElement>('[data-dropdown-trigger]')?.focus();
}

// Opening moves focus into the list so the arrow keys reach it; the caller's own
// label keeps pointing at the trigger, so the field still reads correctly.
function onTriggerKeydown(event: KeyboardEvent): void {
  if (props.disabled) return;
  if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    void show();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    void show(enabledIndex(props.options.length, -1));
  }
}

function onListKeydown(event: KeyboardEvent): void {
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      activeIndex.value = enabledIndex(activeIndex.value, 1);
      break;
    case 'ArrowUp':
      event.preventDefault();
      activeIndex.value = enabledIndex(activeIndex.value, -1);
      break;
    case 'Home':
      event.preventDefault();
      activeIndex.value = enabledIndex(-1, 1);
      break;
    case 'End':
      event.preventDefault();
      activeIndex.value = enabledIndex(props.options.length - 1 < 0 ? 0 : props.options.length - 1, -1);
      break;
    case 'Enter':
    case ' ':
      event.preventDefault();
      choose(activeIndex.value);
      break;
    case 'Escape':
      event.preventDefault();
      // Escape closes the list and stops there: without this the page behind
      // (the settings screen, for one) treats the same press as "leave".
      event.stopPropagation();
      // Escape reverts: the value is left exactly as it was.
      close();
      root.value?.querySelector<HTMLElement>('[data-dropdown-trigger]')?.focus();
      break;
    case 'Tab':
      close();
      break;
    default:
      break;
  }
  void nextTick(() => list.value?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }));
}

function onPointerDown(event: MouseEvent): void {
  if (!root.value?.contains(event.target as Node)) close();
}

watch(open, (isOpen) => {
  if (isOpen) document.addEventListener('pointerdown', onPointerDown, true);
  else document.removeEventListener('pointerdown', onPointerDown, true);
});

onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerDown, true));
</script>

<template>
  <div ref="root" class="dropdown" :class="{ 'dropdown--open': open, 'dropdown--disabled': disabled }">
    <button
      type="button"
      class="dropdown__trigger"
      data-dropdown-trigger
      role="combobox"
      :aria-label="label"
      :aria-expanded="open"
      aria-haspopup="listbox"
      :aria-controls="`dropdown-list-${label}`"
      :disabled="disabled"
      :title="options[selectedIndex]?.hint ?? label"
      @keydown="onTriggerKeydown"
      @click="open ? close() : show()"
    >
      <span v-if="showLabel" class="dropdown__label">{{ label }}</span>
      <span class="dropdown__value">{{ selectedLabel }}</span>
      <ChevronDown class="dropdown__chevron" :size="14" aria-hidden="true" />
    </button>
    <ul
      v-if="open"
      :id="`dropdown-list-${label}`"
      ref="list"
      class="dropdown__list"
      role="listbox"
      :aria-label="label"
      tabindex="-1"
      @keydown="onListKeydown"
    >
      <li
        v-for="(option, index) in options"
        :key="option.value"
        class="dropdown__option"
        :class="{
          'dropdown__option--active': index === activeIndex,
          'dropdown__option--selected': option.value === modelValue,
          'dropdown__option--disabled': option.disabled,
        }"
        role="option"
        :aria-selected="option.value === modelValue"
        :aria-disabled="option.disabled || undefined"
        :data-value="option.value"
        :data-active="index === activeIndex"
        :title="option.hint ?? option.label"
        @pointerenter="!option.disabled && (activeIndex = index)"
        @click="choose(index)"
      >
        <Check v-if="option.value === modelValue" class="dropdown__check" :size="14" aria-hidden="true" />
        <span class="dropdown__option-label">{{ option.label }}</span>
      </li>
    </ul>
  </div>
</template>
