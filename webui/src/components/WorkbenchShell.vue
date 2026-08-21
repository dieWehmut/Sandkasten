<script setup lang="ts">
import type { DeepReadonly } from 'vue';
import type { OutputTab, RunnerPhase } from '../composables/useRunner';
import type { RunHistoryItem } from '../composables/useRunHistory';
import type { JobResponse, Runtime } from '../services/sandkastenApi';
import type { LayoutMode } from '../composables/useMediaLayout';
import EdgeSheet from './EdgeSheet.vue';
import InspectorPanel from './InspectorPanel.vue';
import RunHistory from './RunHistory.vue';
import SourceWorkbench from './SourceWorkbench.vue';

withDefaults(defineProps<{
  historyOpen: boolean;
  inspectorOpen: boolean;
  layoutMode?: LayoutMode;
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
}>(), { layoutMode: 'desktop' });
const emit = defineEmits<{
  selectHistory: [item: DeepReadonly<RunHistoryItem>];
  'update:language': [language: string];
  'update:source': [source: string];
  'update:activeOutputTab': [tab: OutputTab];
  run: [];
  stop: [];
  resume: [];
  closeHistory: [];
  closeInspector: [];
}>();
</script>

<template>
  <div class="workbench-shell" :class="[`layout-${layoutMode}`, { 'without-history': !historyOpen, 'without-inspector': !inspectorOpen }]" data-testid="workbench-shell">
    <RunHistory v-if="layoutMode === 'desktop' && historyOpen" :items="history" :selected-job-id="result?.jobId" @select="emit('selectHistory', $event)" />
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
    <InspectorPanel v-if="layoutMode === 'desktop' && inspectorOpen" :runtime="runtime" :job="result" :error="error" />
    <EdgeSheet v-if="layoutMode !== 'desktop'" :open="historyOpen" side="left" title="Recent runs" @close="emit('closeHistory')">
      <RunHistory :items="history" :selected-job-id="result?.jobId" @select="emit('selectHistory', $event)" />
    </EdgeSheet>
    <EdgeSheet v-if="layoutMode !== 'desktop'" :open="inspectorOpen" side="right" title="Inspector" @close="emit('closeInspector')">
      <InspectorPanel :runtime="runtime" :job="result" :error="error" />
    </EdgeSheet>
  </div>
</template>

<style scoped>
.workbench-shell { display: grid; min-width: 0; height: calc(100vh - 52px); overflow: hidden; }
.workbench-shell.layout-desktop { grid-template-columns: 244px minmax(0, 1fr) 304px; }
.workbench-shell.layout-desktop.without-history { grid-template-columns: minmax(0, 1fr) 304px; }
.workbench-shell.layout-desktop.without-inspector { grid-template-columns: 244px minmax(0, 1fr); }
.workbench-shell.layout-desktop.without-history.without-inspector,
.workbench-shell:not(.layout-desktop) { grid-template-columns: minmax(0, 1fr); }
.workbench-shell > * { min-width: 0; }
.workbench-shell :deep(.run-history), .workbench-shell :deep(.inspector-panel) { overflow: auto; }
.workbench-shell :deep(.source-workbench) { min-width: 0; overflow: auto; }
</style>
