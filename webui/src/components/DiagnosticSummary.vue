<script setup lang="ts">
import { computed } from 'vue';
import type { JobResponse } from '../services/sandkastenApi';

const props = defineProps<{ job?: JobResponse; error?: string }>();
const diagnosticText = computed(() => props.job?.diagnostics && Object.keys(props.job.diagnostics).length
  ? JSON.stringify(props.job.diagnostics, null, 2)
  : 'No structured diagnostics');
</script>

<template>
  <section class="inspector-section" aria-labelledby="diagnostic-summary-title">
    <h3 id="diagnostic-summary-title">Diagnostics</h3>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="job?.errorMessage">{{ job.errorMessage }}</p>
    <pre>{{ diagnosticText }}</pre>
  </section>
</template>

