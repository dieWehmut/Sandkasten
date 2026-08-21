<script setup lang="ts">
import type { JobResponse, Runtime } from '../services/sandkastenApi';
import DiagnosticSummary from './DiagnosticSummary.vue';
import JobInspector from './JobInspector.vue';
import RuntimeInspector from './RuntimeInspector.vue';
import { useTranslation } from '../i18n/useTranslation';

defineProps<{ runtime?: Runtime; job?: JobResponse; error?: string }>();
const t = useTranslation();
</script>

<template>
  <aside id="inspector-panel" class="inspector-panel" aria-labelledby="inspector-title">
    <header class="pane-heading">
      <p class="eyebrow">{{ t('workbench.context') }}</p>
      <h2 id="inspector-title">{{ t('inspector.title') }}</h2>
    </header>
    <RuntimeInspector :runtime="runtime" />
    <JobInspector :job="job" />
    <DiagnosticSummary :job="job" :error="error" />
  </aside>
</template>
