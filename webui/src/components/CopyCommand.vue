<script setup lang="ts">
import { ref, watch } from 'vue';
import { Check, Clipboard } from '@lucide/vue';

const props = withDefaults(defineProps<{
  command: string;
  copyLabel?: string;
  copiedLabel?: string;
  failedLabel?: string;
}>(), {
  copyLabel: 'Copy command',
  copiedLabel: 'Copied',
  failedLabel: 'Copy failed',
});

const state = ref<'idle' | 'copied' | 'failed'>('idle');

watch(() => props.command, () => { state.value = 'idle'; });

async function copyCommand(): Promise<void> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard is unavailable');
    await navigator.clipboard.writeText(props.command);
    state.value = 'copied';
  } catch {
    state.value = 'failed';
  }
}
</script>

<template>
  <div class="copy-command" data-testid="copy-command">
    <pre><code>{{ command }}</code></pre>
    <button
      type="button"
      data-testid="copy-command-button"
      :aria-label="state === 'copied' ? copiedLabel : copyLabel"
      :title="state === 'copied' ? copiedLabel : copyLabel"
      @click="copyCommand"
    >
      <Check v-if="state === 'copied'" :size="16" aria-hidden="true" />
      <Clipboard v-else :size="16" aria-hidden="true" />
      <span>{{ state === 'copied' ? copiedLabel : copyLabel }}</span>
    </button>
    <span
      v-if="state !== 'idle'"
      data-testid="copy-command-status"
      :role="state === 'failed' ? 'alert' : 'status'"
    >{{ state === 'failed' ? failedLabel : copiedLabel }}</span>
  </div>
</template>
