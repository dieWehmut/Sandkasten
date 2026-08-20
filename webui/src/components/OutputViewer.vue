<script setup lang="ts">
import { computed, ref } from 'vue';
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

const channels = computed<Channel[]>(() => {
  const job = props.result;
  if (!job) return props.tab === 'diagnostics' && props.error
    ? [{ label: 'Request error', output: decodeOutput(props.error, 'utf8') }]
    : [];
  if (props.tab === 'output') return [{ label: 'Output', output: decodeOutput(job.stdout, job.stdoutEncoding), encoding: job.stdoutEncoding ?? 'utf8', truncated: job.truncated?.stdout === true }];
  if (props.tab === 'errors') return [{ label: 'Errors', output: decodeOutput(job.stderr, job.stderrEncoding), encoding: job.stderrEncoding ?? 'utf8', truncated: job.truncated?.stderr === true }];
  if (props.tab === 'compile') return [
    { label: 'Compile stdout', output: decodeOutput(job.compileStdout, job.compileStdoutEncoding), encoding: job.compileStdoutEncoding ?? 'utf8' },
    { label: 'Compile stderr', output: decodeOutput(job.compileStderr, job.compileStderrEncoding), encoding: job.compileStderrEncoding ?? 'utf8' },
  ];
  const diagnosticText = job.diagnostics ? JSON.stringify(job.diagnostics, null, 2) : '';
  return [
    { label: 'Error message', output: decodeOutput(job.errorMessage, 'utf8') },
    { label: 'Diagnostics', output: decodeOutput(diagnosticText, 'utf8') },
    { label: 'Request error', output: decodeOutput(props.error, 'utf8') },
  ];
});

const visibleText = computed(() => channels.value.map((channel) => channel.output.text).filter(Boolean).join('\n'));
const hasVisibleChannel = computed(() => channels.value.some((channel) => Boolean(channel.output.text || channel.output.warning || channel.truncated)));
const emptyLabel = computed(() => `No ${props.tab === 'errors' ? 'errors' : props.tab === 'compile' ? 'compile output' : props.tab === 'diagnostics' ? 'diagnostics' : 'output'}`);
const copyLabel = computed(() => `Copy ${props.tab === 'output' ? 'Output' : props.tab.charAt(0).toUpperCase() + props.tab.slice(1)}`);

async function copyVisible() {
  if (!visibleText.value || !navigator.clipboard?.writeText) return;
  await navigator.clipboard.writeText(visibleText.value);
  copied.value = true;
}
</script>

<template>
  <div class="output-viewer">
    <button type="button" :aria-label="copyLabel" :disabled="!visibleText" @click="copyVisible">
      {{ copied ? 'Copied' : 'Copy' }}
    </button>
    <p v-if="!hasVisibleChannel" class="empty-state">{{ emptyLabel }}</p>
    <template v-for="channel in channels" :key="channel.label">
      <section v-if="channel.output.text || channel.output.warning || channel.truncated" class="output-channel">
        <h3 v-if="channels.length > 1">{{ channel.label }}</h3>
        <div class="badges">
          <span v-if="channel.encoding" class="badge">{{ channel.encoding }}</span>
          <span v-if="channel.truncated" class="badge">Truncated</span>
        </div>
        <p v-if="channel.output.warning" role="status">{{ channel.output.warning }}</p>
        <pre>{{ channel.output.text }}</pre>
      </section>
    </template>
  </div>
</template>

<style scoped>
.output-viewer { min-width: 0; }
.output-channel pre { margin: .5rem 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.badges { display: flex; gap: .35rem; }
.badge { border: 1px solid currentColor; border-radius: 3px; padding: 0 .3rem; font-size: .75rem; }
</style>
