<script setup lang="ts">
import type { JobRecord } from '../composables/use-remote-control';
import { runState, stateCategory } from '../presentation';
import AppIcon from './AppIcon.vue';
defineProps<{ jobs: JobRecord[] }>();
defineEmits<{ open: [job: JobRecord] }>();
</script>
<template>
  <div class="list-panel">
    <button v-for="job in jobs" :key="job.jobId" class="list-row run-row" @click="$emit('open', job)">
      <span class="icon-disc secondary"><AppIcon name="agent" /></span>
      <span class="row-copy"><strong>{{ job.projectName }}</strong><small>{{ job.language }} · {{ new Date(job.submittedAt).toLocaleString() }}</small></span>
      <span class="run-status" :data-state="stateCategory(job.status)">{{ runState(job.status) }}</span><AppIcon class="chevron" name="chevron" />
    </button>
  </div>
</template>
