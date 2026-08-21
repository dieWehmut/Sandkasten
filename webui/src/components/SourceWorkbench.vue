<script setup lang="ts">
import type { RunnerPhase, OutputTab } from '../composables/useRunner';
import type { JobResponse, Runtime } from '../services/sandkastenApi';
import JobTimeline from './JobTimeline.vue';
import OutputTabs from './OutputTabs.vue';
import SourceEditor from './SourceEditor.vue';
import WorkbenchToolbar from './WorkbenchToolbar.vue';
import { useTranslation } from '../i18n/useTranslation';

defineProps<{
  runtimes: Runtime[];
  language: string;
  source: string;
  phase: RunnerPhase;
  currentJob?: JobResponse;
  result?: JobResponse;
  error?: string;
  pollingStopped?: boolean;
  activeOutputTab: OutputTab;
  canRun: boolean;
  canResume?: boolean;
}>();
const emit = defineEmits<{
  'update:language': [language: string];
  'update:source': [source: string];
  'update:activeOutputTab': [tab: OutputTab];
  run: [];
  stop: [];
  resume: [];
}>();
const t = useTranslation();
</script>

<template>
  <main class="source-workbench" :aria-label="t('workbench.source')">
    <WorkbenchToolbar
      :runtimes="runtimes"
      :language="language"
      :phase="phase"
      :can-run="canRun"
      :can-resume="canResume"
      @update:language="emit('update:language', $event)"
      @run="emit('run')"
      @stop="emit('stop')"
      @resume="emit('resume')"
    />
    <section class="editor-region" :aria-label="t('workbench.editor')">
      <SourceEditor :model-value="source" :language="language" :label="t('workbench.programSource')" @update:model-value="emit('update:source', $event)" />
    </section>
    <JobTimeline :phase="phase" :current-job="currentJob" :error="error" :polling-stopped="pollingStopped" />
    <section class="output-region" :aria-label="t('workbench.resultOutput')">
      <OutputTabs :result="result" :error="error" :model-value="activeOutputTab" @update:model-value="emit('update:activeOutputTab', $event)" />
    </section>
  </main>
</template>
