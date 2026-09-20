<script setup lang="ts">
import { computed, watch } from 'vue';
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
}>(), { theme: 'light', locale: 'en' });

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
    <DesktopMenu
      v-if="integrated"
      :chrome="chrome"
      :locale="locale"
      :t="translate"
    />
    <span v-if="windowTitle" class="app-header__title" data-testid="window-title">{{ windowTitle }}</span>
  </header>
</template>