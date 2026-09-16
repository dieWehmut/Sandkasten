<script setup lang="ts">
import type { RunnerPhase } from '../composables/useRunner';
import type { Runtime } from '../services/sandkastenApi';
import RunControls from './RunControls.vue';
import RuntimeSelect from './RuntimeSelect.vue';

defineProps<{
  runtimes: Runtime[];
  language: string;
  phase: RunnerPhase;
  canRun: boolean;
  canResume?: boolean;
}>();
const emit = defineEmits<{
  'update:language': [language: string];
  run: [];
  stop: [];
  resume: [];
}>();
</script>

<template>
  <header class="workbench-toolbar">
    <RuntimeSelect :model-value="language" :runtimes="runtimes" :disabled="phase === 'booting'" @update:model-value="emit('update:language', $event)" />
    <RunControls :phase="phase" :can-run="canRun" :can-resume="canResume" @run="emit('run')" @stop="emit('stop')" @resume="emit('resume')" />
  </header>
</template>
