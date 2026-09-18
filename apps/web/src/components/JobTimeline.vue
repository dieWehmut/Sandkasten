<script setup lang="ts">
import { computed } from 'vue';
import type { JobResponse } from '../services/sandkastenApi';
import type { ExecutionPhase } from '../composables/execution';
import { statusLabel } from '../state/status';
import { useTranslation } from '../i18n/useTranslation';

const props = defineProps<{
  phase: ExecutionPhase;
  currentJob?: JobResponse;
  error?: string;
  pollingStopped?: boolean;
}>();
const t = useTranslation();
const phaseKeys: Record<ExecutionPhase, Parameters<typeof t>[0]> = {
  booting: 'phase.booting',
  ready: 'phase.ready',
  submitting: 'phase.submitting',
  polling: 'phase.polling',
  stopped: 'phase.stopped',
  completed: 'phase.completed',
  error: 'phase.error',
  running: 'phase.running',
  unavailable: 'phase.unavailable',
};

const phaseLabel = computed(() => {
  if (props.pollingStopped || props.phase === 'stopped') return t('timeline.monitoringStopped');
  if (props.currentJob?.status) return statusLabel(props.currentJob.status, t);
  return t(phaseKeys[props.phase]);
});
</script>

<template>
  <section class="job-timeline" :aria-label="t('timeline.label')" aria-live="polite">
    <p>{{ phaseLabel }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
  </section>
</template>
