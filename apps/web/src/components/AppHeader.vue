<script setup lang="ts">
import { computed } from 'vue';
import { Terminal } from '@lucide/vue';
import type { ConnectionState } from '../composables/useRunner';
import type { Theme } from '../composables/useTheme';
import type { ColorScheme } from '../theme/colorScheme';
import { createTranslator, type Locale, type Translator } from '../i18n/locale';
import ConnectionStatus from './ConnectionStatus.vue';
import HeaderActions from './HeaderActions.vue';

const props = withDefaults(defineProps<{
  connectionState: ConnectionState;
  historyOpen?: boolean;
  inspectorOpen?: boolean;
  theme?: Theme;
  colorScheme?: ColorScheme;
  locale?: Locale;
  t?: Translator;
}>(), { theme: 'light', colorScheme: 'green', locale: 'en' });

const emit = defineEmits<{
  toggleHistory: [];
  toggleInspector: [];
  toggleTheme: [];
  changeColorScheme: [scheme: ColorScheme];
  openGithub: [];
  openSetup: [];
  changeLocale: [locale: Locale];
}>();

const englishTranslator = createTranslator('en');
const translate = computed(() => props.t ?? englishTranslator);
</script>

<template>
  <header class="app-header" data-testid="app-header">
    <a class="brand" href="./" :aria-label="translate('brand.home')">
      <Terminal :size="19" aria-hidden="true" />
      <strong>{{ translate('brand.name') }}</strong>
    </a>
    <ConnectionStatus :state="connectionState" :t="translate" />
    <HeaderActions
      :history-open="historyOpen"
      :inspector-open="inspectorOpen"
      :theme="theme"
      :color-scheme="colorScheme"
      :locale="locale"
      :t="translate"
      @toggle-history="emit('toggleHistory')"
      @toggle-inspector="emit('toggleInspector')"
      @toggle-theme="emit('toggleTheme')"
      @change-color-scheme="emit('changeColorScheme', $event)"
      @open-github="emit('openGithub')"
      @open-setup="emit('openSetup')"
      @change-locale="emit('changeLocale', $event)"
    />
  </header>
</template>
