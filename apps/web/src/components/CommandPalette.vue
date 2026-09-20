<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { ChevronRight } from '@lucide/vue';
import FileIcon from './FileIcon.vue';
import type { PaletteItem } from '../composables/useCommandCenter';
import { createTranslator, type Translator } from '../i18n/locale';

const props = defineProps<{ open: boolean; query: string; items: readonly PaletteItem[]; t?: Translator; error?: string }>();
const emit = defineEmits<{ close: []; 'update:query': [value: string]; select: [id: string] }>();
const t = computed(() => props.t ?? createTranslator('en'));
const id = useId();
const input = ref<HTMLInputElement>();
const panel = ref<HTMLElement>();
const selected = ref(0);
let opener: HTMLElement | undefined;
const optionId = (index: number) => `${id}-option-${index}`;

function restoreFocus(): void {
  if (opener?.isConnected) opener.focus();
  opener = undefined;
}

watch(() => props.open, async (open) => {
  if (open) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    selected.value = 0;
    await nextTick();
    input.value?.focus();
  } else {
    await nextTick();
    restoreFocus();
  }
}, { immediate: true });

watch(() => [props.query, props.items], () => { selected.value = 0; });
watch(selected, async () => {
  await nextTick();
  panel.value?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
});

function onKeydown(event: KeyboardEvent): void {
  if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab'].includes(event.key)) {
    event.preventDefault();
    event.stopPropagation();
  }
  if (event.key === 'Escape') emit('close');
  if (event.key === 'Enter' && props.items[selected.value]) emit('select', props.items[selected.value].id);
  if (!props.items.length) return;
  if (event.key === 'ArrowDown') selected.value = (selected.value + 1) % props.items.length;
  if (event.key === 'ArrowUp') selected.value = (selected.value + props.items.length - 1) % props.items.length;
}

function onPointerdown(event: PointerEvent): void {
  if (props.open && event.target instanceof Node && !panel.value?.contains(event.target)) emit('close');
}
onMounted(() => document.addEventListener('pointerdown', onPointerdown));
onBeforeUnmount(() => { document.removeEventListener('pointerdown', onPointerdown); restoreFocus(); });
</script>

<template>
  <section v-if="open" ref="panel" class="command-palette" data-testid="command-palette"
    role="dialog" aria-modal="true" :aria-label="t('palette.title')" @keydown="onKeydown">
    <input ref="input" class="command-palette__input" role="combobox" :value="query"
      :aria-label="t('palette.title')" :placeholder="t('palette.placeholder')" autocomplete="off" spellcheck="false"
      aria-autocomplete="list" aria-expanded="true" :aria-controls="`${id}-list`"
      :aria-activedescendant="items.length ? optionId(selected) : undefined"
      @input="emit('update:query', ($event.target as HTMLInputElement).value)" />
    <div :id="`${id}-list`" class="command-palette__list" role="listbox" :aria-label="t('palette.results')">
      <div v-for="(item, index) in items" :id="optionId(index)" :key="`${item.kind}-${item.id}`"
        class="command-palette__item" role="option" :aria-selected="index === selected"
        :data-kind="item.kind" :data-command="item.kind === 'file' ? undefined : item.id"
        @pointermove="selected = index" @mousedown.prevent @click="emit('select', item.id)">
        <FileIcon v-if="item.kind === 'file'" :name="item.id" />
        <ChevronRight v-else :size="16" aria-hidden="true" />
        <span class="command-palette__label">{{ item.label }}</span>
        <span v-if="item.detail" class="command-palette__detail">{{ item.detail }}</span>
        <span v-if="item.recent" class="command-palette__recent">{{ t('palette.recent') }}</span>
        <kbd v-if="item.accelerator">{{ item.accelerator }}</kbd>
      </div>
    </div>
    <p v-if="!items.length" class="command-palette__empty" role="status">{{ t('palette.empty') }}</p>
    <p v-if="error" class="command-palette__error" role="alert">{{ error }}</p>
  </section>
</template>
