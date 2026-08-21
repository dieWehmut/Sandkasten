<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Check, Copy } from '@lucide/vue';
import type { JobResponse } from '../services/sandkastenApi';
import { decodeOutput, type DecodedOutput } from '../services/sandkastenApi';
import type { OutputTab } from '../composables/useRunner';

interface Channel {
  label: string;
  output: DecodedOutput;
  encoding?: string;
  truncated?: boolean;
}

const props = defineProps<{ result?: JobResponse; error?: string; tab: OutputTab }>();
const copied = ref(false);
const copyError = ref('');

const channels = computed<Channel[]>(() => {
  const job = props.result;
  if (!job) return props.tab === 'diagnostics' && props.error
    ? [{ label: 'Request error', output: decodeOutput(props.error, 'utf8'), encoding: 'utf8' }]
    : [];
  if (props.tab === 'output') return [{ label: 'Output', output: decodeOutput(job.stdout, job.stdoutEncoding), encoding: job.stdoutEncoding ?? 'utf8', truncated: job.truncated?.stdout === true }];
  if (props.tab === 'errors') return [{ label: 'Errors', output: decodeOutput(job.stderr, job.stderrEncoding), encoding: job.stderrEncoding ?? 'utf8', truncated: job.truncated?.stderr === true }];
  if (props.tab === 'compile') return [
    { label: 'Compile stdout', output: decodeOutput(job.compileStdout, job.compileStdoutEncoding), encoding: job.compileStdoutEncoding ?? 'utf8' },
    { label: 'Compile stderr', output: decodeOutput(job.compileStderr, job.compileStderrEncoding), encoding: job.compileStderrEncoding ?? 'utf8' },
  ];
  const diagnosticText = job.diagnostics ? JSON.stringify(job.diagnostics, null, 2) : '';
  const diagnosticChannels = [
    { label: 'Error message', output: decodeOutput(job.errorMessage, 'utf8'), encoding: 'utf8' },
    { label: 'Diagnostics', output: decodeOutput(diagnosticText, 'utf8'), encoding: 'utf8' },
    { label: 'Request error', output: decodeOutput(props.error, 'utf8'), encoding: 'utf8' },
  ];
  const visibleChannels = diagnosticChannels.filter((channel) => channel.output.text || channel.output.warning);
  return visibleChannels.length
    ? visibleChannels
    : [{ label: 'Diagnostics', output: decodeOutput('', 'utf8'), encoding: 'utf8' }];
});

const visibleText = computed(() => channels.value.map((channel) => channel.output.text).filter(Boolean).join('\n'));
const hasVisibleChannel = computed(() => channels.value.some((channel) => Boolean(channel.output.text || channel.output.warning || channel.truncated)));
const emptyLabel = computed(() => `No ${props.tab === 'errors' ? 'errors' : props.tab === 'compile' ? 'compile output' : props.tab === 'diagnostics' ? 'diagnostics' : 'output'}`);
const copyLabel = computed(() => `Copy ${props.tab === 'output' ? 'Output' : props.tab.charAt(0).toUpperCase() + props.tab.slice(1)}`);

watch(() => [props.tab, props.result?.jobId, visibleText.value], () => {
  copied.value = false;
  copyError.value = '';
});

async function copyVisible() {
  if (!visibleText.value || !navigator.clipboard?.writeText) return;
  try {
    await navigator.clipboard.writeText(visibleText.value);
    copied.value = true;
    copyError.value = '';
  } catch {
    copied.value = false;
    copyError.value = 'Copy failed';
  }
}
</script>

<template>
  <div class="output-viewer">
    <button type="button" :aria-label="copyLabel" :title="copyLabel" :disabled="!visibleText" @click="copyVisible">
      <Check v-if="copied" :size="16" aria-hidden="true" />
      <Copy v-else :size="16" aria-hidden="true" />
    </button>
    <p v-if="copyError" role="alert">{{ copyError }}</p>
    <p v-if="!hasVisibleChannel && !channels.length" class="empty-state">{{ emptyLabel }}</p>
    <template v-for="channel in channels" :key="channel.label">
      <section v-if="channel.output.text || channel.output.warning || channel.truncated || channel.encoding" class="output-channel">
        <h3 v-if="channels.length > 1">{{ channel.label }}</h3>
        <div class="badges">
          <span v-if="channel.encoding" class="badge">{{ channel.encoding }}</span>
          <span v-if="channel.truncated" class="badge">Truncated</span>
        </div>
        <p v-if="channel.output.warning" role="status">{{ channel.output.warning }}</p>
        <pre v-if="channel.output.text">{{ channel.output.text }}</pre>
        <p v-else-if="!channel.output.warning && !channel.truncated" class="empty-state">{{ emptyLabel }}</p>
      </section>
    </template>
  </div>
</template>
