<script setup lang="ts">
import { CirclePlay, CircleStop, RotateCcw } from '@lucide/vue';
import type { RunnerPhase } from '../composables/useRunner';
import { useTranslation } from '../i18n/useTranslation';

const props = withDefaults(defineProps<{ phase: RunnerPhase; canRun?: boolean; canResume?: boolean }>(), { canRun: true, canResume: true });
const emit = defineEmits<{ run: []; stop: []; resume: [] }>();
const t = useTranslation();
</script>

<template>
  <div class="run-controls">
    <button v-if="props.phase === 'polling'" type="button" data-action="stop-polling" :aria-label="t('controls.stopPolling')" @click="emit('stop')">
      <CircleStop :size="17" aria-hidden="true" /> <span>{{ t('controls.stopPolling') }}</span>
    </button>
    <template v-else>
      <button v-if="props.canResume && (props.phase === 'stopped' || props.phase === 'error')" type="button" data-action="resume-polling" :aria-label="t('controls.resumePolling')" @click="emit('resume')">
        <RotateCcw :size="17" aria-hidden="true" /> <span>{{ t('controls.resumePolling') }}</span>
      </button>
      <button
        type="button"
        data-action="run-source"
        class="run-source-action"
        :aria-label="props.canResume && (props.phase === 'stopped' || props.phase === 'error') ? t('controls.runNewSource') : t('controls.runSource')"
        :disabled="!canRun || props.phase === 'booting' || props.phase === 'submitting'"
        @click="emit('run')"
      >
        <CirclePlay :size="17" aria-hidden="true" />
        <span>{{ props.phase === 'submitting' ? t('controls.submitting') : props.canResume && (props.phase === 'stopped' || props.phase === 'error') ? t('controls.runNew') : t('controls.run') }}</span>
      </button>
    </template>
  </div>
</template>
