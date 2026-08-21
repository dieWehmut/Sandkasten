<script setup lang="ts">
import { computed } from 'vue';
import type { JobResponse } from '../services/sandkastenApi';
import { useTranslation } from '../i18n/useTranslation';

const props = defineProps<{ job?: JobResponse; error?: string }>();
const t = useTranslation();
const diagnosticText = computed(() => props.job?.diagnostics && Object.keys(props.job.diagnostics).length
  ? JSON.stringify(props.job.diagnostics, null, 2)
  : t('diagnostics.noStructured'));
</script>

<template>
  <section class="inspector-section" aria-labelledby="diagnostic-summary-title">
    <h3 id="diagnostic-summary-title">{{ t('diagnostics.title') }}</h3>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="job?.errorMessage">{{ job.errorMessage }}</p>
    <pre>{{ diagnosticText }}</pre>
  </section>
</template>
