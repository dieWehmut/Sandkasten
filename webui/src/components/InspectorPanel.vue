<script setup lang="ts">
import type { JobResponse, Runtime } from '../services/sandkastenApi';
import DiagnosticSummary from './DiagnosticSummary.vue';
import JobInspector from './JobInspector.vue';
import RuntimeInspector from './RuntimeInspector.vue';

defineProps<{ runtime?: Runtime; job?: JobResponse; error?: string }>();
</script>

<template>
  <aside class="inspector-panel" aria-labelledby="inspector-title">
    <header class="pane-heading">
      <p class="eyebrow">Context</p>
      <h2 id="inspector-title">Inspector</h2>
    </header>
    <RuntimeInspector :runtime="runtime" />
    <JobInspector :job="job" />
    <DiagnosticSummary :job="job" :error="error" />
  </aside>
</template>
