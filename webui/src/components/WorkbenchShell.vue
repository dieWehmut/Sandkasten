<script setup lang="ts">
import type { DeepReadonly } from 'vue';
import type { OutputTab, RunnerPhase } from '../composables/useRunner';
import type { RunHistoryItem } from '../composables/useRunHistory';
import type { JobResponse, Runtime } from '../services/sandkastenApi';
import InspectorPanel from './InspectorPanel.vue';
import RunHistory from './RunHistory.vue';
import SourceWorkbench from './SourceWorkbench.vue';

defineProps<{
  historyOpen: boolean;
  inspectorOpen: boolean;
  history: readonly DeepReadonly<RunHistoryItem>[];
  runtimes: Runtime[];
  runtime?: Runtime;
  language: string;
  source: string;
  phase: RunnerPhase;
  currentJob?: JobResponse;
  result?: JobResponse;
  error?: string;
  pollingStopped?: boolean;
  activeOutputTab: OutputTab;
  canRun: boolean;
  canResume: boolean;
}>();
const emit = defineEmits<{
  selectHistory: [item: DeepReadonly<RunHistoryItem>];
  'update:language': [language: string];
  'update:source': [source: string];
  'update:activeOutputTab': [tab: OutputTab];
  run: [];
  stop: [];
  resume: [];
}>();
</script>

<template>
  <div class="workbench-shell" :class="{ 'without-history': !historyOpen, 'without-inspector': !inspectorOpen }" data-testid="workbench-shell">
    <RunHistory v-if="historyOpen" :items="history" :selected-job-id="result?.jobId" @select="emit('selectHistory', $event)" />
    <SourceWorkbench
      :runtimes="runtimes"
      :language="language"
      :source="source"
      :phase="phase"
      :current-job="currentJob"
      :result="result"
      :error="error"
      :polling-stopped="pollingStopped"
      :active-output-tab="activeOutputTab"
      :can-run="canRun"
      :can-resume="canResume"
      @update:language="emit('update:language', $event)"
      @update:source="emit('update:source', $event)"
      @update:active-output-tab="emit('update:activeOutputTab', $event)"
      @run="emit('run')"
      @stop="emit('stop')"
      @resume="emit('resume')"
    />
    <InspectorPanel v-if="inspectorOpen" :runtime="runtime" :job="result" :error="error" />
  </div>
</template>

<style scoped>
.workbench-shell { display: grid; grid-template-columns: 244px minmax(0, 1fr) 304px; min-width: 0; height: calc(100vh - 52px); overflow: hidden; }
.workbench-shell.without-history { grid-template-columns: minmax(0, 1fr) 304px; }
.workbench-shell.without-inspector { grid-template-columns: 244px minmax(0, 1fr); }
.workbench-shell.without-history.without-inspector { grid-template-columns: minmax(0, 1fr); }
.workbench-shell > * { min-width: 0; }
.workbench-shell :deep(.run-history), .workbench-shell :deep(.inspector-panel) { overflow: auto; }
.workbench-shell :deep(.source-workbench) { min-width: 0; overflow: auto; }
</style>
