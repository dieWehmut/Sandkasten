<script setup lang="ts">
import { computed, watch } from 'vue';
import { ArrowLeft, ArrowRight } from '@lucide/vue';
// Inlined as a data URI so the four-file distribution contract keeps holding.
import brandMark from '../assets/brand-88.png?inline';
import type { Theme } from '../composables/useTheme';
import { createTranslator, type Locale, type Translator } from '../i18n/locale';
import type { WindowChromeBridge } from '../services/desktopBridge';
import DesktopMenu from './DesktopMenu.vue';

const props = withDefaults(defineProps<{
  theme?: Theme;
  locale?: Locale;
  t?: Translator;
  windowTitle?: string;
  /** Present only inside the Electron shell with the integrated window chrome. */
  chrome?: WindowChromeBridge;
  platform?: string;
  canBack?: boolean;
  canForward?: boolean;
}>(), { theme: 'light', locale: 'en' });

const emit = defineEmits<{ navigateBack: []; navigateForward: [] }>();

const englishTranslator = createTranslator('en');
const translate = computed(() => props.t ?? englishTranslator);
const integrated = computed(() => Boolean(props.chrome?.integrated));

// The native Windows/Linux overlay paints the caption buttons, so it has to
// follow the active theme instead of keeping the startup light colors.
watch(() => props.theme, (theme) => {
  if (!integrated.value) return;
  void props.chrome?.setTheme(theme).catch((error) => {
    console.warn('window chrome theme failed', error);
  });
}, { immediate: true });

const isMac = computed(() => props.platform === 'darwin');
</script>

<template>
  <header
    class="app-header"
    :class="{ 'app-header--integrated': integrated, 'app-header--mac': integrated && isMac }"
    data-testid="app-header"
  >
    <a class="brand" href="./" :aria-label="translate('brand.home')">
      <img class="brand__mark" :src="brandMark" alt="" aria-hidden="true" />
    </a>
    <nav class="editor-navigation" :aria-label="translate('navigation.label')">
      <button type="button" data-action="navigate-back" :disabled="!canBack"
        :aria-label="translate('navigation.back')" :title="`${translate('navigation.back')} (Alt+Left)`"
        aria-keyshortcuts="Alt+ArrowLeft" @click="emit('navigateBack')">
        <ArrowLeft :size="18" aria-hidden="true" />
      </button>
      <button type="button" data-action="navigate-forward" :disabled="!canForward"
        :aria-label="translate('navigation.forward')" :title="`${translate('navigation.forward')} (Alt+Right)`"
        aria-keyshortcuts="Alt+ArrowRight" @click="emit('navigateForward')">
        <ArrowRight :size="18" aria-hidden="true" />
      </button>
    </nav>
    <DesktopMenu
      v-if="integrated"
      :chrome="chrome"
      :locale="locale"
      :t="translate"
    />
    <span v-if="windowTitle" class="app-header__title" data-testid="window-title">{{ windowTitle }}</span>
  </header>
</template>
