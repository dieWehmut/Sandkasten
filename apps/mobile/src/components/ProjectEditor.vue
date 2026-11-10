<script setup lang="ts">
import { computed } from 'vue';
import type { Runtime } from '../client';
import type { Project } from '../projects';
import { exampleSource } from '../projects';
import BottomPicker, { type PickerOption } from './BottomPicker.vue';
const props = defineProps<{ project: Project; runtimes: Runtime[] }>();
const runtimeOptions = computed<PickerOption[]>(() => {
  const options = props.runtimes.map(runtime => ({
    value: runtime.language,
    label: runtime.language,
    description: [runtime.version, runtime.default_entrypoint].filter(Boolean).join(' · '),
  }));
  if (!options.some(option => option.value === props.project.language)) {
    options.unshift({ value: props.project.language, label: props.project.language, description: '当前设备未提供此运行时' });
  }
  return options;
});
function changeLanguage(language: string) {
  const old = props.project.language;
  if (language === old) return;
  if (!props.project.source.trim() || props.project.source === exampleSource(old)) props.project.source = exampleSource(language);
  props.project.language = language;
  props.project.entrypoint = '';
}
</script>
<template>
  <div class="project-editor">
    <div class="field-pair">
      <label>项目名称<input v-model="project.name" maxlength="80" required /></label>
      <BottomPicker :model-value="project.language" label="运行时" title="选择运行时" description="选择电脑提供的运行时；已编辑的代码会保留。" icon="code" :options="runtimeOptions" @update:model-value="changeLanguage" />
    </div>
    <label>源代码<textarea v-model="project.source" class="source-editor" rows="8" placeholder="输入要在电脑运行的源代码" autocapitalize="off" autocomplete="off" spellcheck="false" /></label>
    <details>
      <summary>输入、参数与文件</summary>
      <div class="project-inputs">
        <label>入口文件<input v-model="project.entrypoint" :placeholder="runtimes.find(r => r.language === project.language)?.default_entrypoint || '使用运行时默认入口'" autocapitalize="off" spellcheck="false" /></label>
        <label>标准输入<textarea v-model="project.stdin" rows="2" placeholder="可选的 stdin" /></label>
        <label>运行参数（JSON 字符串数组）<input v-model="project.args" placeholder='["arg1", "arg2"]' autocapitalize="off" spellcheck="false" /></label>
        <label>运行超时（毫秒，0 使用电脑默认值）<input v-model.number="project.runTimeoutMs" type="number" min="0" step="1000" /></label>
        <div v-for="(file, index) in project.files" :key="index" class="project-files">
          <label>附加文件名<input v-model="file.name" placeholder="data.txt" autocapitalize="off" spellcheck="false" /></label>
          <label>文件内容<textarea v-model="file.content" class="source-editor" rows="3" /></label>
          <button class="text-button" type="button" :aria-label="`移除附加文件 ${index + 1}`" @click="project.files.splice(index, 1)">移除文件</button>
        </div>
        <button class="tonal-button" type="button" :disabled="project.files.length >= 32" @click="project.files.push({ name: '', content: '' })">添加文本文件</button>
      </div>
    </details>
  </div>
</template>
