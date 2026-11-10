<script setup lang="ts">
import { computed, ref } from 'vue';
import type { RunPanel, RemoteHost } from '../composables/use-remote-fleet';
import { runState } from '../presentation';
import RunOutput from './RunOutput.vue';
import ProjectEditor from './ProjectEditor.vue';
import AppIcon from './AppIcon.vue';
import BottomPicker, { type PickerOption } from './BottomPicker.vue';
const props = defineProps<{ panel: RunPanel; host: RemoteHost }>();
defineEmits<{ close: []; save: [] }>();
const mode = ref<'source' | 'output'>('source');
const control = props.host.control;
const jobs = computed(() => control.jobs.value.filter(j => j.projectId === props.panel.project.id));
const selected = computed(() => jobs.value.find(j => j.jobId === props.panel.selectedJobId.value));
const jobOptions = computed<PickerOption[]>(() => jobs.value.map(job => ({
  value: job.jobId,
  label: `${runState(job.status)} · ${job.jobId.slice(0, 8)}`,
  description: `${job.language || props.panel.project.language} · ${new Date(job.submittedAt).toLocaleString()}`,
})));
const disconnected = computed(() => !['connected', 'reconnecting'].includes(control.connectionStatus.value));
async function submit() { const job = await control.submit(props.panel.project); if (job) { props.panel.selectedJobId.value = job.jobId; mode.value = 'output'; } }
</script>
<template>
  <article class="workbench panel" :aria-label="`${host.name} ${panel.project.name} 工作栏`">
    <header class="workbench-heading"><div><small>{{ host.name }}</small><h2>{{ panel.project.name }}</h2><span class="agent-label"><AppIcon name="agent" />{{ panel.project.language }}</span></div><button class="text-button" aria-label="关闭此栏" @click="$emit('close')">×</button></header>
    <div class="filter-chips pane-tabs"><button :aria-pressed="mode === 'source'" @click="mode = 'source'">代码</button><button :aria-pressed="mode === 'output'" @click="mode = 'output'">输出</button></div>
    <div class="workbench-scroll">
      <p v-if="control.error.value" class="error-banner" role="alert">{{ control.error.value }}</p>
      <p v-if="disconnected" class="hint">请在设置中连接这台电脑；代码草稿仍可编辑。</p>
      <form v-if="mode === 'source'" class="pane-composer form-panel" @submit.prevent="submit">
        <ProjectEditor :project="panel.project" :runtimes="control.runtimes.value" />
        <div class="output-actions"><button type="button" class="tonal-button" @click="$emit('save')"><AppIcon name="file" />保存项目</button><button class="primary-button" :disabled="control.busy.value || disconnected || !panel.project.source.trim()"><AppIcon name="send" />运行</button></div>
        <p class="hint">草稿独立于其他工作栏；保存后可在项目页重新打开。</p>
      </form>
      <template v-else>
        <BottomPicker v-if="jobs.length" v-model="panel.selectedJobId.value" class="pane-task-picker" label="查看任务" title="选择任务" placeholder="选择任务" icon="history" :options="jobOptions" />
        <RunOutput v-if="selected" :job="selected" :busy="control.busy.value" :disabled="disconnected" @cancel="control.cancel(selected.jobId)" @remove="control.remove(selected.jobId)" @refresh="control.refresh()" />
        <div v-else class="empty-state"><AppIcon name="agent" /><p>运行后，电脑输出会显示在此栏。</p></div>
      </template>
    </div>
  </article>
</template>
