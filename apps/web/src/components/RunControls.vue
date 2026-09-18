<script setup lang="ts">
import { computed } from 'vue';
import { CirclePlay, CircleStop, RotateCcw } from '@lucide/vue';
import type { ExecutionPhase } from '../composables/execution';
import { useTranslation } from '../i18n/useTranslation';

const props = withDefaults(defineProps<{ phase: ExecutionPhase; canRun?: boolean; canResume?: boolean }>(), { canRun: true, canResume: true });
const emit = defineEmits<{ run: []; stop: []; resume: [] }>();
const t = useTranslation();

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
        :disabled="!canRun || props.phase === 'booting' || props.phase === 'submitting' || props.phase === 'unavailable'"
        @click="emit('run')"
      >
        <CirclePlay :size="17" aria-hidden="true" />
        <span>{{ props.phase === 'submitting' ? t('controls.submitting') : resumable ? t('controls.runNew') : t('controls.run') }}</span>
      </button>
    </template>
  </div>
</template>