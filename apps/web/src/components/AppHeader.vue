<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue';
// Inlined as a data URI so the four-file distribution contract keeps holding.
import brandMark from '../assets/brand-88.png?inline';
import type { ConnectionState } from '../composables/useRunner';
import type { Theme } from '../composables/useTheme';
import type { ColorScheme } from '../theme/colorScheme';
import { createTranslator, type Locale, type Translator } from '../i18n/locale';
import type { WindowChromeBridge } from '../services/desktopBridge';
import ConnectionStatus from './ConnectionStatus.vue';
import DesktopMenu from './DesktopMenu.vue';
import HeaderActions from './HeaderActions.vue';

const props = withDefaults(defineProps<{
  connectionState: ConnectionState;
  historyOpen?: boolean;
  inspectorOpen?: boolean;
  theme?: Theme;
  colorScheme?: ColorScheme;
  locale?: Locale;
  t?: Translator;
  windowTitle?: string;
  /** Present only inside the Electron shell with the integrated window chrome. */
  chrome?: WindowChromeBridge;
  platform?: string;
}>(), { theme: 'light', colorScheme: 'green', locale: 'en' });

const emit = defineEmits<{
  toggleHistory: [];
  toggleInspector: [];
  toggleTheme: [];
  changeColorScheme: [scheme: ColorScheme];
  openGithub: [];
  openSetup: [];
  openApiEndpoint: [];
  changeLocale: [locale: Locale];
}>();

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
      <strong>{{ translate('brand.name') }}</strong>
    </a>
    <DesktopMenu
      v-if="integrated"
      :chrome="chrome"
      :locale="locale"
      :t="translate"
    />
    <span v-if="windowTitle" class="app-header__title" data-testid="window-title">{{ windowTitle }}</span>
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
      @open-api-endpoint="emit('openApiEndpoint')"
      @change-locale="emit('changeLocale', $event)"
    />
  </header>
</template>