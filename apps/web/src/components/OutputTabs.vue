<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { decodeOutput, type JobResponse } from '../services/sandkastenApi';
import type { OutputTab } from '../composables/useRunner';
import OutputViewer from './OutputViewer.vue';
import { useTranslation } from '../i18n/useTranslation';
import type { TerminalController } from '../composables/useTerminal';
import TerminalPanel from './ide/TerminalPanel.vue';

const props = withDefaults(defineProps<{ result?: JobResponse; error?: string; modelValue?: OutputTab; terminal?: TerminalController }>(), { modelValue: 'output' });
const emit = defineEmits<{ 'update:modelValue': [value: OutputTab] }>();
const t = useTranslation();
type PanelTab = OutputTab | 'terminal';
const tabs = computed<Array<{ id: PanelTab; labelKey: Parameters<typeof t>[0] }>>(() => [
  { id: 'output', labelKey: 'output.output' },
  { id: 'errors', labelKey: 'output.errors' },
  { id: 'compile', labelKey: 'output.compile' },
  { id: 'diagnostics', labelKey: 'output.diagnostics' },
  ...(props.terminal ? [{ id: 'terminal' as const, labelKey: 'terminal.title' as const }] : []),
]);
const selected = ref<OutputTab>(props.modelValue);
const active = computed<PanelTab>(() => props.terminal?.shown.value ? 'terminal' : selected.value);
const tabElements = ref<HTMLButtonElement[]>([]);
const instanceId = `output-tabs-${Math.random().toString(36).slice(2)}`;

function hasChannelContent(tab: PanelTab): boolean {
  if (tab === 'terminal') return false;
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

function choose(tab: PanelTab) {
  if (tab === 'terminal') {
    props.terminal?.show();
    if (!props.terminal?.sessions.value.length && !props.terminal?.pending.value) void props.terminal?.create();
    void nextTick(() => props.terminal?.focus());
    return;
  }
  props.terminal?.showOutput();
  selected.value = tab;
  emit('update:modelValue', tab);
}

async function move(event: KeyboardEvent, index: number) {
  let next = index;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.value.length;
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + tabs.value.length) % tabs.value.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = tabs.value.length - 1;
  else return;
  event.preventDefault();
  choose(tabs.value[next].id);
  await nextTick();
  tabElements.value[next]?.focus();
}
</script>

<template>
  <section class="output-tabs" :class="{ 'output-tabs--terminal': active === 'terminal' }">
    <div role="tablist" :aria-label="t('workbench.jobOutput')">
      <button
        v-for="(tab, index) in tabs"
        :id="`${instanceId}-${tab.id}-tab`"
        :key="tab.id"
        :ref="(element) => { if (element) tabElements[index] = element as HTMLButtonElement; }"
        type="button"
        :data-action="`select-output-${tab.id}`"
        role="tab"
        :aria-selected="active === tab.id"
        :aria-controls="`${instanceId}-panel`"
        :tabindex="active === tab.id ? 0 : -1"
        @click="choose(tab.id)"
        @keydown="move($event, index)"
      >
        {{ t(tab.labelKey) }}
        <span v-if="hasChannelContent(tab.id)" class="tab-indicator" :aria-label="t('output.containsContent')">*</span>
      </button>
    </div>
    <div
      :id="`${instanceId}-panel`"
      role="tabpanel"
      :aria-labelledby="`${instanceId}-${active}-tab`"
      :tabindex="active === 'terminal' ? -1 : 0"
    >
      <TerminalPanel v-if="terminal && active === 'terminal'" :controller="terminal" />
      <OutputViewer v-else :result="result" :error="error" :tab="selected" />
    </div>
  </section>
</template>
