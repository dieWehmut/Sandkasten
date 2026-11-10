<script setup lang="ts">
import { computed } from 'vue';
import { decodeOutput } from '../client';
import type { JobRecord } from '../composables/use-remote-control';
import { isTerminal, runState, stateCategory } from '../presentation';
import AppIcon from './AppIcon.vue';
const props = defineProps<{ job: JobRecord; busy: boolean; disabled?: boolean }>();
defineEmits<{ cancel: []; remove: []; refresh: [] }>();
const output = computed(() => [
  { label: '编译标准输出', value: props.job.compileStdout, encoding: props.job.compileStdoutEncoding },
  { label: '编译错误输出', value: props.job.compileStderr, encoding: props.job.compileStderrEncoding },
  { label: '标准输出', value: props.job.stdout, encoding: props.job.stdoutEncoding },
  { label: '错误输出', value: props.job.stderr, encoding: props.job.stderrEncoding },
].filter(item => !!item.value).map(item => ({ ...item, ...decodeOutput(item.value, item.encoding) })));
</script>
<template>
  <section class="panel task-summary">
    <div class="section-line"><span class="agent-label"><AppIcon name="agent" />{{ job.language }}</span><span class="run-status" :data-state="stateCategory(job.status)">{{ runState(job.status) }}</span></div>
    <p class="task-prompt">{{ job.projectName }}</p>
    <p class="hint project-path">任务 {{ job.jobId }}</p>
    <p class="hint">{{ new Date(job.submittedAt).toLocaleString() }}<template v-if="job.exitCode !== undefined"> · 退出码 {{ job.exitCode }}</template><template v-if="job.durationMs !== undefined"> · {{ job.durationMs }} ms</template><template v-if="job.signal"> · 信号 {{ job.signal }}</template></p>
    <div class="output-actions">
      <button v-if="!isTerminal(job.status)" class="primary-button" :disabled="busy || disabled" @click="$emit('cancel')"><AppIcon name="stop" />停止任务</button>
      <button class="tonal-button" :disabled="busy || disabled" @click="$emit('refresh')"><AppIcon name="refresh" />刷新输出</button>
      <button v-if="isTerminal(job.status)" class="tonal-button" :disabled="busy" @click="$emit('remove')">删除本机记录</button>
    </div>
  </section>
  <p v-if="job.errorMessage" role="alert" class="error-banner">{{ job.errorMessage }}</p>
  <p v-if="job.truncated?.stdout || job.truncated?.stderr" class="hint">输出达到电脑端上限，部分内容已截断。</p>
  <h2 class="subheading">运行输出</h2>
  <p v-if="job.outputReady === false && output.length" class="hint" role="status">电脑正在完成输出，内容会自动更新。</p>
  <div v-if="!output.length" class="panel empty-state"><AppIcon name="agent" /><p>{{ job.outputReady === false ? '电脑正在收集运行输出，完成后会自动更新。' : isTerminal(job.status) ? '任务已结束，没有文本输出。' : '电脑正在处理任务，输出会自动更新。' }}</p></div>
  <article v-for="item in output" :key="item.label" class="event-panel" :class="{ 'event-error': item.label.includes('错误') }">
    <span class="event-label">{{ item.label }}</span>
    <p v-if="item.warning" class="hint" role="status">{{ item.warning }} · 以下保留原始数据</p>
    <pre class="source-output">{{ item.text }}</pre>
  </article>
</template>
