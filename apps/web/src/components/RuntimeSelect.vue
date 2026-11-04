<script setup lang="ts">
import { computed } from 'vue';
import type { Runtime } from '../services/sandkastenApi';
import { useTranslation } from '../i18n/useTranslation';
import DropdownSelect from './DropdownSelect.vue';
import type { DropdownOption } from './dropdownOptions';

const props = defineProps<{ modelValue: string; runtimes: Runtime[]; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const t = useTranslation();

function runtimeLabel(runtime: Runtime): string {
  return [runtime.language, runtime.version].filter(Boolean).join(' ');
}

// The reference lists the runtimes in a themed `.monaco-list`, not in the
// operating system's own select popup, which cannot be styled at all.
const options = computed<DropdownOption[]>(() => (props.runtimes.length
  ? props.runtimes.map((runtime) => ({ value: runtime.language, label: runtimeLabel(runtime) }))
  : [{ value: '', label: t('workbench.noRuntimes'), disabled: true }]));
</script>

<template>
  <div class="runtime-select">
    <span class="runtime-select__label">{{ t('workbench.runtime') }}</span>
    <DropdownSelect
      :model-value="modelValue"
      :options="options"
      :label="t('workbench.runtime')"
      :disabled="disabled || !runtimes.length"
      @update:model-value="emit('update:modelValue', $event)"
    />
  </div>
</template>
