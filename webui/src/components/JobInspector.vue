<script setup lang="ts">
import type { JobResponse } from '../services/sandkastenApi';
import { statusLabel } from '../state/status';

defineProps<{ job?: JobResponse }>();

function durationLabel(value: number | undefined): string {
  if (value === undefined) return '-';
  return value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(2)} s`;
}
</script>

<template>
  <section class="inspector-section" aria-labelledby="job-inspector-title">
    <h3 id="job-inspector-title">Job</h3>
    <p v-if="!job" class="empty-state">Run source to inspect a job.</p>
    <template v-else>
      <dl class="metadata-list">
        <div><dt>Job ID</dt><dd>{{ job.jobId }}</dd></div>
        <div><dt>Status</dt><dd>{{ statusLabel(job.status) }}</dd></div>
        <div v-if="job.language"><dt>Language</dt><dd>{{ job.language }}</dd></div>
        <div v-if="job.runtime"><dt>Runtime image</dt><dd>{{ job.runtime }}</dd></div>
        <div><dt>Duration</dt><dd>{{ durationLabel(job.durationMs) }}</dd></div>
        <div><dt>Exit code</dt><dd>{{ job.exitCode ?? 'Not reported' }}</dd></div>
        <div><dt>Signal</dt><dd>{{ job.signal ?? 'Not reported' }}</dd></div>
      </dl>
      <h4>Encoding</h4>
      <dl class="metadata-list">
        <div><dt>stdout</dt><dd>{{ job.stdoutEncoding ?? 'utf8' }}</dd></div>
        <div><dt>stderr</dt><dd>{{ job.stderrEncoding ?? 'utf8' }}</dd></div>
        <div><dt>Compile stdout</dt><dd>{{ job.compileStdoutEncoding ?? 'utf8' }}</dd></div>
        <div><dt>Compile stderr</dt><dd>{{ job.compileStderrEncoding ?? 'utf8' }}</dd></div>
      </dl>
      <h4>Truncation</h4>
      <p>{{ job.truncated?.stdout || job.truncated?.stderr ? [job.truncated?.stdout ? 'stdout' : '', job.truncated?.stderr ? 'stderr' : ''].filter(Boolean).join(', ') + ' Truncated' : 'No channels truncated' }}</p>
    </template>
  </section>
</template>
