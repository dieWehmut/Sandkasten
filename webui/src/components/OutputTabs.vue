<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { decodeOutput, type JobResponse } from '../services/sandkastenApi';
import type { OutputTab } from '../composables/useRunner';
import OutputViewer from './OutputViewer.vue';

const props = withDefaults(defineProps<{ result?: JobResponse; error?: string; modelValue?: OutputTab }>(), { modelValue: 'output' });
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

function hasChannelContent(tab: OutputTab): boolean {
  const job = props.result;
  if (tab === 'output') {
    const decoded = decodeOutput(job?.stdout, job?.stdoutEncoding);
    return Boolean(decoded.text || decoded.warning || job?.truncated?.stdout);
  }
  if (tab === 'errors') {
    const decoded = decodeOutput(job?.stderr, job?.stderrEncoding);
    return Boolean(decoded.text || decoded.warning || job?.truncated?.stderr);
  }
  if (tab === 'compile') {
    const stdout = decodeOutput(job?.compileStdout, job?.compileStdoutEncoding);
    const stderr = decodeOutput(job?.compileStderr, job?.compileStderrEncoding);
    return Boolean(stdout.text || stdout.warning || stderr.text || stderr.warning);
  }
  return Boolean(props.error || job?.errorMessage || (job?.diagnostics && Object.keys(job.diagnostics).length));
}

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
        <span v-if="hasChannelContent(tab.id)" class="tab-indicator" aria-label="Contains content">*</span>
      </button>
    </div>
    <div
      :id="`${instanceId}-panel`"
      role="tabpanel"
      :aria-labelledby="`${instanceId}-${selected}-tab`"
      tabindex="0"
    >
      <OutputViewer :result="result" :error="error" :tab="selected" />
    </div>
  </section>
</template>

<style scoped>
[role="tablist"] { display: flex; gap: .25rem; }
[role="tab"][aria-selected="true"] { font-weight: 700; }
.tab-indicator { display: inline-block; width: .4rem; height: .4rem; border-radius: 999px; background: currentColor; font-size: 0; vertical-align: middle; }
[role="tabpanel"] { min-width: 0; padding-top: .5rem; }
</style>
