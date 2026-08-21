<script setup lang="ts">
import { CirclePlay, CircleStop, RotateCcw } from '@lucide/vue';
import type { RunnerPhase } from '../composables/useRunner';

const props = withDefaults(defineProps<{ phase: RunnerPhase; canRun?: boolean; canResume?: boolean }>(), { canRun: true, canResume: true });
const emit = defineEmits<{ run: []; stop: []; resume: [] }>();
</script>

<template>
  <div class="run-controls">
    <button v-if="props.phase === 'polling'" type="button" aria-label="Stop polling" @click="emit('stop')">
      <CircleStop :size="17" aria-hidden="true" /> <span>Stop polling</span>
    </button>
    <button v-else-if="props.phase === 'stopped' || (props.phase === 'error' && props.canResume)" type="button" aria-label="Resume polling" :disabled="!props.canResume" @click="emit('resume')">
      <RotateCcw :size="17" aria-hidden="true" /> <span>Resume polling</span>
    </button>
    <button v-else type="button" aria-label="Run source" :disabled="!canRun || props.phase === 'booting' || props.phase === 'submitting'" @click="emit('run')">
      <CirclePlay :size="17" aria-hidden="true" /> <span>{{ props.phase === 'submitting' ? 'Submitting' : 'Run' }}</span>
    </button>
  </div>
</template>
