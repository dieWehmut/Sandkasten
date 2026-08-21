<script setup lang="ts">
import { ref } from 'vue';
import type { Translator } from '../i18n/locale';
import type { InstallMode, RuntimePreset } from '../setup/installGuide';
import SetupGuide from './SetupGuide.vue';

defineProps<{ t: Translator }>();
const emit = defineEmits<{ dismiss: [] }>();
const mode = ref<InstallMode>('cli');
const runtimePreset = ref<RuntimePreset>('core');
</script>

<template>
  <main class="setup-welcome" data-testid="setup-welcome">
    <header class="setup-welcome__intro">
      <p class="eyebrow">{{ t('brand.name') }}</p>
      <h1 data-testid="setup-title">{{ t('setup.title') }}</h1>
      <p>{{ t('setup.subtitle') }}</p>
    </header>

    <SetupGuide
      v-model:mode="mode"
      v-model:runtime-preset="runtimePreset"
      :t="t"
    />

    <div class="setup-welcome__actions">
      <button type="button" data-testid="setup-dismiss" @click="emit('dismiss')">
        {{ t('setup.dismiss') }}
      </button>
    </div>
  </main>
</template>
