<script setup lang="ts">
import { ref } from 'vue';
import type { Locale, Translator } from '../i18n/locale';
import type { InstallMode, RuntimePreset } from '../setup/installGuide';
import LocaleSwitcher from './LocaleSwitcher.vue';
import SetupGuide from './SetupGuide.vue';

withDefaults(defineProps<{ t: Translator; locale?: Locale }>(), { locale: 'en' });
const emit = defineEmits<{ dismiss: []; changeLocale: [locale: Locale] }>();
const mode = ref<InstallMode>('cli');
const runtimePreset = ref<RuntimePreset>('core');
</script>

<template>
  <main class="setup-welcome" data-testid="setup-welcome">
    <header class="setup-welcome__intro">
      <div class="setup-welcome__toolbar">
        <p class="eyebrow">{{ t('brand.name') }}</p>
        <LocaleSwitcher :locale="locale" :t="t" @change="emit('changeLocale', $event)" />
      </div>
      <h1 data-testid="setup-title">{{ t('setup.title') }}</h1>
      <p>{{ t('setup.subtitle') }}</p>
    </header>

    <SetupGuide
      v-model:mode="mode"
      v-model:runtime-preset="runtimePreset"
      :t="t"
    />

    <div class="setup-welcome__actions">
      <button type="button" data-testid="setup-dismiss" data-action="dismiss-setup" @click="emit('dismiss')">
        {{ t('setup.dismiss') }}
      </button>
    </div>
  </main>
</template>
