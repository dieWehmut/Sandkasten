<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import type { JobResponse } from '../services/sandkastenApi';
import type { OutputTab } from '../composables/useRunner';
import OutputViewer from './OutputViewer.vue';

const props = withDefaults(defineProps<{ result?: JobResponse; modelValue?: OutputTab }>(), { modelValue: 'output' });
const emit = defineEmits<{ 'update:modelValue': [value: OutputTab] }>();
const tabs: Array<{ id: OutputTab; label: string }> = [
  { id: 'output', label: 'Output' },
  { id: 'errors', label: 'Errors' },
  { id: 'compile', label: 'Compile' },
  { id: 'diagnostics', label: 'Diagnostics' },
];
const selected = ref<OutputTab>(props.modelValue);
const tabElements = ref<HTMLButtonElement[]>([]);
const instanceId = `output-tabs-${Math.random().toString(36).slice(2)}`;

watch(() => props.modelValue, (value) => { selected.value = value; });

function choose(tab: OutputTab) {
  selected.value = tab;
  emit('update:modelValue', tab);
}

async function move(event: KeyboardEvent, index: number) {
  let next = index;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length;
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + tabs.length) % tabs.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = tabs.length - 1;
  else return;
  event.preventDefault();
  choose(tabs[next].id);
  await nextTick();
  tabElements.value[next]?.focus();
}
</script>

<template>
  <section class="output-tabs">
    <div role="tablist" aria-label="Job output">
      <button
        v-for="(tab, index) in tabs"
        :id="`${instanceId}-${tab.id}-tab`"
        :key="tab.id"
        :ref="(element) => { if (element) tabElements[index] = element as HTMLButtonElement; }"
        type="button"
        role="tab"
        :aria-selected="selected === tab.id"
        :aria-controls="`${instanceId}-panel`"
        :tabindex="selected === tab.id ? 0 : -1"
        @click="choose(tab.id)"
        @keydown="move($event, index)"
      >
        {{ tab.label }}
      </button>
    </div>
    <div
      :id="`${instanceId}-panel`"
      role="tabpanel"
      :aria-labelledby="`${instanceId}-${selected}-tab`"
      tabindex="0"
    >
      <OutputViewer :result="result" :tab="selected" />
    </div>
  </section>
</template>

<style scoped>
[role="tablist"] { display: flex; gap: .25rem; }
[role="tab"][aria-selected="true"] { font-weight: 700; }
[role="tabpanel"] { min-width: 0; padding-top: .5rem; }
</style>
