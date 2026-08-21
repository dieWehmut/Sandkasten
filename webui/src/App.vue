<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AppHeader from './components/AppHeader.vue';
import WorkbenchShell from './components/WorkbenchShell.vue';
import { useRunner } from './composables/useRunner';

const runner = useRunner();
const historyOpen = ref(true);
const inspectorOpen = ref(true);

const selectedRuntime = computed(() => runner.runtimes.value.find((runtime) => runtime.language === runner.selectedLanguage.value));
const canRun = computed(() => runner.connectionState.value === 'connected'
  && Boolean(runner.selectedLanguage.value)
  && Boolean(runner.source.value.trim())
  && !['booting', 'submitting', 'polling'].includes(runner.phase.value));

function toggleTheme(): void {
  const root = document.documentElement;
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
}

function openGithub(): void {
  window.open('https://github.com/dieWehmut/Sandkasten', '_blank', 'noopener,noreferrer');
}

onMounted(() => { void runner.load(); });
</script>

<template>
  <div class="workbench-app" data-testid="app-shell">
    <AppHeader
      :connection-state="runner.connectionState.value"
      :history-open="historyOpen"
      :inspector-open="inspectorOpen"
      @toggle-history="historyOpen = !historyOpen"
      @toggle-inspector="inspectorOpen = !inspectorOpen"
      @toggle-theme="toggleTheme"
      @open-github="openGithub"
    />
    <section v-if="runner.connectionState.value === 'unavailable'" class="connection-error" role="alert">
      <span>{{ runner.error.value }}</span>
      <button type="button" @click="runner.load">Retry runtime connection</button>
    </section>
    <WorkbenchShell
      :history-open="historyOpen"
      :inspector-open="inspectorOpen"
      :history="runner.history.value"
      :runtimes="runner.runtimes.value"
      :runtime="selectedRuntime"
      :language="runner.selectedLanguage.value"
      :source="runner.source.value"
      :phase="runner.phase.value"
      :current-job="runner.currentJob.value"
      :result="runner.result.value"
      :error="runner.requestError.value"
      :polling-stopped="runner.pollingStopped.value"
      :active-output-tab="runner.activeOutputTab.value"
      :can-run="canRun"
      :can-resume="runner.canResumePolling.value"
      @select-history="runner.selectHistoryItem"
      @update:language="runner.setLanguage"
      @update:source="runner.setSource"
      @update:active-output-tab="runner.setActiveOutputTab"
      @run="runner.submit"
      @stop="runner.stopPolling"
      @resume="runner.resumePolling"
    />
  </div>
</template>

<style>
:root { color: #211d1e; background: #f7f6f3; font: 14px/1.5 Inter, system-ui, sans-serif; }
* { box-sizing: border-box; }
html, body, #app { min-width: 320px; min-height: 100%; margin: 0; }
button, select { font: inherit; }
button { cursor: pointer; }
.workbench-app { min-height: 100vh; background: #f7f6f3; }
.app-header { display: flex; align-items: center; gap: 1rem; height: 52px; padding: 0 .9rem; border-bottom: 1px solid #d9d3d4; background: #fff; }
.brand, .connection-status, .header-actions, .run-controls, .history-item__primary, .history-item__meta { display: flex; align-items: center; gap: .45rem; }
.brand { color: inherit; text-decoration: none; }
.connection-status { margin-left: auto; }
.header-actions button, .run-controls button { display: inline-flex; align-items: center; gap: .35rem; min-height: 2rem; }
.run-history, .inspector-panel { padding: 1rem; background: #fff; }
.run-history { border-right: 1px solid #d9d3d4; }
.inspector-panel { border-left: 1px solid #d9d3d4; }
.pane-heading h2, .inspector-section h3, .inspector-section h4 { margin: 0 0 .6rem; }
.eyebrow { margin: 0; color: #746b6d; font-size: .75rem; text-transform: uppercase; }
.history-list { display: grid; gap: .35rem; }
.history-item { display: grid; width: 100%; min-width: 0; gap: .25rem; padding: .65rem; text-align: left; border: 1px solid #d9d3d4; background: #fff; }
.history-item__primary { justify-content: space-between; min-width: 0; }
.history-item__meta { color: #746b6d; font-size: .75rem; }
.source-workbench { display: grid; grid-template-rows: auto minmax(18rem, 1fr) auto minmax(12rem, .75fr); min-width: 0; min-height: 0; }
.workbench-toolbar { display: flex; justify-content: space-between; align-items: end; gap: 1rem; min-width: 0; padding: .65rem 1rem; border-bottom: 1px solid #d9d3d4; background: #fff; }
.runtime-select { display: grid; gap: .2rem; min-width: 12rem; }
.editor-region, .output-region, .job-timeline { min-width: 0; padding: .75rem 1rem; }
.output-region { overflow: auto; border-top: 1px solid #d9d3d4; background: #fff; }
.job-timeline { border-top: 1px solid #d9d3d4; border-bottom: 1px solid #d9d3d4; }
.metadata-list { display: grid; gap: .35rem; margin: 0 0 1rem; }
.metadata-list > div { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr); gap: .5rem; min-width: 0; }
.metadata-list dt { color: #746b6d; }
.metadata-list dd { min-width: 0; margin: 0; overflow-wrap: anywhere; }
.inspector-section { min-width: 0; padding: 1rem 0; border-top: 1px solid #d9d3d4; }
.inspector-section pre { white-space: pre-wrap; overflow-wrap: anywhere; }
.connection-error { display: flex; justify-content: space-between; gap: 1rem; padding: .5rem 1rem; color: #721c24; background: #f8d7da; }
.empty-state { color: #746b6d; }
</style>
