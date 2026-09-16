<script setup lang="ts">
import type { JobResponse } from '../services/sandkastenApi';
import { statusLabel } from '../state/status';
import { useTranslation } from '../i18n/useTranslation';

defineProps<{ job?: JobResponse }>();
const t = useTranslation();

function durationLabel(value: number | undefined): string {
  if (value === undefined) return '-';
  return value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(2)} s`;
}
</script>

<template>
  <section class="inspector-section" aria-labelledby="job-inspector-title">
    <h3 id="job-inspector-title">{{ t('inspector.job') }}</h3>
    <p v-if="!job" class="empty-state">{{ t('inspector.jobEmpty') }}</p>
    <template v-else>
      <dl class="metadata-list">
        <div><dt>{{ t('inspector.jobId') }}</dt><dd>{{ job.jobId }}</dd></div>
        <div><dt>{{ t('inspector.status') }}</dt><dd>{{ statusLabel(job.status, t) }}</dd></div>
        <div v-if="job.language"><dt>{{ t('inspector.language') }}</dt><dd>{{ job.language }}</dd></div>
        <div v-if="job.runtime"><dt>{{ t('inspector.runtimeVersion') }}</dt><dd>{{ job.runtime }}</dd></div>
        <div><dt>{{ t('inspector.duration') }}</dt><dd>{{ durationLabel(job.durationMs) }}</dd></div>
        <div><dt>{{ t('inspector.exitCode') }}</dt><dd>{{ job.exitCode ?? t('inspector.notReported') }}</dd></div>
        <div><dt>{{ t('inspector.signal') }}</dt><dd>{{ job.signal ?? t('inspector.notReported') }}</dd></div>
      </dl>
      <h4>{{ t('inspector.encoding') }}</h4>
      <dl class="metadata-list">
        <div><dt>stdout</dt><dd>{{ job.stdoutEncoding ?? 'utf8' }}</dd></div>
        <div><dt>stderr</dt><dd>{{ job.stderrEncoding ?? 'utf8' }}</dd></div>
        <div><dt>{{ t('inspector.compileStdout') }}</dt><dd>{{ job.compileStdoutEncoding ?? 'utf8' }}</dd></div>
        <div><dt>{{ t('inspector.compileStderr') }}</dt><dd>{{ job.compileStderrEncoding ?? 'utf8' }}</dd></div>
      </dl>
      <h4>{{ t('inspector.truncation') }}</h4>
      <p>{{ job.truncated?.stdout || job.truncated?.stderr ? [job.truncated?.stdout ? 'stdout' : '', job.truncated?.stderr ? 'stderr' : ''].filter(Boolean).join(', ') + ' ' + t('inspector.truncated') : t('inspector.noChannelsTruncated') }}</p>
    </template>
  </section>
</template>
