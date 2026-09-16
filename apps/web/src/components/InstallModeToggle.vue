<script setup lang="ts">
import { useId } from 'vue';
import type { Translator } from '../i18n/locale';
import type { InstallMode } from '../setup/installGuide';

const props = defineProps<{ modelValue: InstallMode; t: Translator }>();
const emit = defineEmits<{ 'update:modelValue': [mode: InstallMode] }>();
const groupId = useId();

function chooseMode(mode: InstallMode): void {
  if (mode !== props.modelValue) emit('update:modelValue', mode);
}
</script>

<template>
  <fieldset class="setup-choice-group" data-testid="install-mode-toggle">
    <legend>{{ t('setup.mode') }}</legend>
    <div class="setup-choice-grid setup-choice-grid--two">
      <label class="setup-choice" :for="`${groupId}-cli`">
        <input
          :id="`${groupId}-cli`"
          :name="`${groupId}-install-mode`"
          type="radio"
          value="cli"
          :checked="modelValue === 'cli'"
          data-testid="install-mode-cli"
          @change="chooseMode('cli')"
        >
        <span>{{ t('setup.mode.cli') }}</span>
      </label>
      <label class="setup-choice" :for="`${groupId}-webui`">
        <input
          :id="`${groupId}-webui`"
          :name="`${groupId}-install-mode`"
          type="radio"
          value="webui"
          :checked="modelValue === 'webui'"
          data-testid="install-mode-webui"
          @change="chooseMode('webui')"
        >
        <span>{{ t('setup.mode.webui') }}</span>
      </label>
    </div>
  </fieldset>
</template>
