<script setup lang="ts">
import type { Runtime } from '../services/sandkastenApi';
import { useTranslation } from '../i18n/useTranslation';

defineProps<{ modelValue: string; runtimes: Runtime[]; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const t = useTranslation();

function runtimeLabel(runtime: Runtime): string {
  return [runtime.language, runtime.version].filter(Boolean).join(' ');
}
</script>

<template>
  <label class="runtime-select">
    <span>{{ t('workbench.runtime') }}</span>
    <select :value="modelValue" :aria-label="t('workbench.runtime')" :disabled="disabled || !runtimes.length" @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)">
      <option v-if="!runtimes.length" value="">{{ t('workbench.noRuntimes') }}</option>
      <option v-for="runtime in runtimes" :key="runtime.language" :value="runtime.language">{{ runtimeLabel(runtime) }}</option>
    </select>
  </label>
</template>
