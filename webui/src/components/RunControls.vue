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
    <template v-else>
      <button v-if="props.canResume && (props.phase === 'stopped' || props.phase === 'error')" type="button" aria-label="Resume polling" @click="emit('resume')">
        <RotateCcw :size="17" aria-hidden="true" /> <span>Resume polling</span>
      </button>
      <button
        type="button"
        :aria-label="props.canResume && (props.phase === 'stopped' || props.phase === 'error') ? 'Run new source' : 'Run source'"
        :disabled="!canRun || props.phase === 'booting' || props.phase === 'submitting'"
        @click="emit('run')"
      >
        <CirclePlay :size="17" aria-hidden="true" />
        <span>{{ props.phase === 'submitting' ? 'Submitting' : props.canResume && (props.phase === 'stopped' || props.phase === 'error') ? 'Run new' : 'Run' }}</span>
      </button>
    </template>
  </div>
</template>
