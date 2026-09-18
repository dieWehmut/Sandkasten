<script setup lang="ts">
import type { JobResponse, Runtime } from '../services/sandkastenApi';
import DiagnosticSummary from './DiagnosticSummary.vue';
import JobInspector from './JobInspector.vue';
import RuntimeInspector from './RuntimeInspector.vue';
import { useTranslation } from '../i18n/useTranslation';

const props = withDefaults(defineProps<{ runtime?: Runtime; job?: JobResponse; error?: string; hideHeading?: boolean }>(), { hideHeading: false });
const t = useTranslation();
</script>

<template>
  <aside
    id="inspector-panel"
    class="inspector-panel"
    :aria-labelledby="props.hideHeading ? undefined : 'inspector-title'"
    :aria-label="props.hideHeading ? t('inspector.title') : undefined"
  >
    <header v-if="!props.hideHeading" class="pane-heading">
      <p class="eyebrow">{{ t('workbench.context') }}</p>
      <h2 id="inspector-title">{{ t('inspector.title') }}</h2>
    </header>
    <RuntimeInspector :runtime="runtime" />
    <JobInspector :job="job" />
    <DiagnosticSummary :job="job" :error="error" />
  </aside>
</template>
