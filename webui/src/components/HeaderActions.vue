<script setup lang="ts">
import { computed } from 'vue';
import { BookOpen, GitFork, History, Moon, PanelRight, Sun } from '@lucide/vue';
import type { Theme } from '../composables/useTheme';
import { createTranslator, type Locale, type Translator } from '../i18n/locale';
import LocaleSwitcher from './LocaleSwitcher.vue';

const props = withDefaults(defineProps<{
  historyOpen?: boolean;
  inspectorOpen?: boolean;
  theme?: Theme;
  locale?: Locale;
  t?: Translator;
}>(), { theme: 'light', locale: 'en' });

const emit = defineEmits<{
  toggleHistory: [];
  toggleInspector: [];
  toggleTheme: [];
  openGithub: [];
  openSetup: [];
  changeLocale: [locale: Locale];
}>();

const englishTranslator = createTranslator('en');
const translate = computed(() => props.t ?? englishTranslator);
const historyLabel = computed(() => translate.value(props.historyOpen ? 'header.history.hide' : 'header.history.show'));
const inspectorLabel = computed(() => translate.value(props.inspectorOpen ? 'header.inspector.hide' : 'header.inspector.show'));
const themeLabel = computed(() => translate.value(props.theme === 'light' ? 'header.theme.useDark' : 'header.theme.useLight'));
</script>

<template>
  <nav class="header-actions" :aria-label="translate('header.actions')">
    <button
      type="button"
      data-testid="open-setup-guide"
      data-action="open-setup-guide"
      :aria-label="translate('header.setup')"
      :title="translate('header.setup')"
      @click="emit('openSetup')"
    >
      <BookOpen :size="17" aria-hidden="true" />
    </button>
    <LocaleSwitcher
      :locale="locale"
      :t="translate"
      @change="emit('changeLocale', $event)"
    />
    <button
      type="button"
      data-action="toggle-history"
      :aria-label="historyLabel"
      :title="historyLabel"
      :aria-expanded="Boolean(historyOpen)"
      aria-controls="history-panel"
      @click="emit('toggleHistory')"
    >
      <History :size="17" aria-hidden="true" />
    </button>
    <button
      type="button"
      data-action="toggle-inspector"
      :aria-label="inspectorLabel"
      :title="inspectorLabel"
      :aria-expanded="Boolean(inspectorOpen)"
      aria-controls="inspector-panel"
      @click="emit('toggleInspector')"
    >
      <PanelRight :size="17" aria-hidden="true" />
    </button>
    <button
      type="button"
      data-action="toggle-theme"
      :aria-label="themeLabel"
      :title="themeLabel"
      @click="emit('toggleTheme')"
    >
      <Moon v-if="theme === 'light'" :size="17" aria-hidden="true" />
      <Sun v-else :size="17" aria-hidden="true" />
    </button>
    <button
      type="button"
      data-action="open-github"
      :aria-label="translate('header.github')"
      :title="translate('header.github')"
      @click="emit('openGithub')"
    >
      <GitFork :size="17" aria-hidden="true" />
    </button>
  </nav>
</template>
