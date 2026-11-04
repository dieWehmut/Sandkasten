<script setup lang="ts">
import { computed } from 'vue';
import { CirclePlay, CircleStop, RotateCcw } from '@lucide/vue';
import type { ExecutionPhase } from '../composables/execution';
import { isExecutionRunnable } from '../composables/execution';
import { useTranslation } from '../i18n/useTranslation';

const props = withDefaults(defineProps<{ phase: ExecutionPhase; canRun?: boolean; canResume?: boolean }>(), { canRun: true, canResume: true });
const emit = defineEmits<{ run: []; stop: []; resume: [] }>();
const t = useTranslation();

// Which phases can start a run is a shared predicate, not a list repeated at each call
// site. It was duplicated here and in the shell, and the copies had drifted: this one
// treated `submitting` as idle, and the template then re-checked two of the same
// phases a third time in its disabled binding. The copies disagreed about what "not
// runnable" means, so the button could stay enabled mid-submission.
const runnable = computed(() => isExecutionRunnable(props.phase));
// The stop button is not the inverse of runnable: it only appears once there is
// something to stop, which excludes `submitting` (no job exists yet) and `stopped`
// (the run already ended).
const busy = computed(() => props.phase === 'polling' || props.phase === 'running');
const resumable = computed(() => props.canResume && (props.phase === 'stopped' || props.phase === 'error'));
const stopLabel = computed(() => t(props.phase === 'running' ? 'controls.stopRun' : 'controls.stopPolling'));
</script>

<template>
  <div class="run-controls">
    <button v-if="busy" type="button" data-action="stop-polling" :aria-label="stopLabel" @click="emit('stop')">
      <CircleStop :size="17" aria-hidden="true" /> <span>{{ stopLabel }}</span>
    </button>
    <template v-else>
      <button v-if="resumable" type="button" data-action="resume-polling" :aria-label="t('controls.resumePolling')" @click="emit('resume')">
        <RotateCcw :size="17" aria-hidden="true" /> <span>{{ t('controls.resumePolling') }}</span>
      </button>
      <button
        type="button"
        data-action="run-source"
        class="run-source-action"
        :aria-label="resumable ? t('controls.runNewSource') : t('controls.runSource')"
        :disabled="!canRun || !runnable"
        @click="emit('run')"
      >
        <CirclePlay :size="17" aria-hidden="true" />
        <span>{{ props.phase === 'submitting' ? t('controls.submitting') : resumable ? t('controls.runNew') : t('controls.run') }}</span>
      </button>
    </template>
  </div>
</template>