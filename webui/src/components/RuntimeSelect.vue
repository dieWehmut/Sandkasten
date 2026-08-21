<script setup lang="ts">
import type { Runtime } from '../services/sandkastenApi';

defineProps<{ modelValue: string; runtimes: Runtime[]; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

function runtimeLabel(runtime: Runtime): string {
  return [runtime.language, runtime.version].filter(Boolean).join(' ');
}
</script>

<template>
  <label class="runtime-select">
    <span>Runtime</span>
    <select :value="modelValue" aria-label="Runtime" :disabled="disabled || !runtimes.length" @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)">
      <option v-if="!runtimes.length" value="">No runtimes available</option>
      <option v-for="runtime in runtimes" :key="runtime.language" :value="runtime.language">{{ runtimeLabel(runtime) }}</option>
    </select>
  </label>
</template>
