<script setup lang="ts">
import { computed } from 'vue';
import type { JobResponse } from '../services/sandkastenApi';
import type { RunnerPhase } from '../composables/useRunner';
import { statusLabel } from '../state/status';

const props = defineProps<{
  phase: RunnerPhase;
  currentJob?: JobResponse;
  error?: string;
  pollingStopped?: boolean;
}>();

const phaseLabel = computed(() => {
  if (props.pollingStopped || props.phase === 'stopped') return 'Monitoring stopped. The job may still be running.';
  if (props.currentJob?.status) return statusLabel(props.currentJob.status);
  return props.phase.charAt(0).toUpperCase() + props.phase.slice(1);
});
</script>

<template>
  <section class="job-timeline" aria-label="Job timeline" aria-live="polite">
    <p>{{ phaseLabel }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.job-timeline { min-width: 0; }
.job-timeline p { overflow-wrap: anywhere; }
</style>
