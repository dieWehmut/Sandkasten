<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { ArrowLeft, BookOpen, Clock, ExternalLink, Info, Palette, Search, Server, Settings } from '@lucide/vue';
import type { AppearanceColor, AppearanceColors } from '../composables/useAppearance';
import type { Theme, ThemePreference } from '../composables/useTheme';
import type { ConnectionState } from '../composables/useRunner';
import type { Locale, Translator } from '../i18n/locale';
import type { MessageKey } from '../i18n/messages';
import { colorSchemeOptions, type ColorScheme } from '../theme/colorScheme';
import LocaleSwitcher from './LocaleSwitcher.vue';
import brandMark from '../assets/brand-88.png?inline';

// Settings is the get-started page's sibling rather than a second design: the
// same marked header, 13 px page type, 1.5em section titles and bordered action
// tiles carry every section, and only the anatomy that has to survive stays the
// settings editor's — the search field, the theme previews, and the marker that
// names a setting the user changed.
const props = defineProps<{
  preference: ThemePreference; theme: Theme; colors: AppearanceColors; colorScheme: ColorScheme;
  locale: Locale; t: Translator; connectionState: ConnectionState; apiEndpoint: string;
  /** Which colors the user has overridden for the active theme (the "modified" marker). */
  customized?: Partial<Record<AppearanceColor, boolean>>;
}>();
const emit = defineEmits<{
  back: []; changeTheme: [value: ThemePreference]; changeColor: [key: AppearanceColor, value: string];
  resetColors: []; changeColorScheme: [value: ColorScheme]; changeLocale: [value: Locale];
  openApiEndpoint: []; openSetup: []; showHistory: []; showInspector: []; openGithub: [];
}>();
type Section = 'general' | 'appearance' | 'connection' | 'workbench';
const search = ref('');
const selected = ref<Section>('appearance');
const heading = ref<HTMLElement>();
const sections: { id: Section; icon: typeof Settings; keys: MessageKey[] }[] = [
  { id: 'general', icon: Settings, keys: ['locale.label', 'setup.guide', 'header.github'] },
  { id: 'appearance', icon: Palette, keys: ['settings.theme', 'settings.system', 'settings.light', 'settings.dark', 'settings.accent', 'settings.background', 'settings.foreground', 'header.colorScheme'] },
  { id: 'connection', icon: Server, keys: ['apiEndpoint.title', 'apiEndpoint.label', 'settings.connectionStatus'] },
  { id: 'workbench', icon: Info, keys: ['header.history.show', 'header.inspector.show'] },
];
const visibleSections = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  return sections.filter((section) => [props.t(`settings.${section.id}`), ...section.keys.map(props.t)].some((label) => label.toLocaleLowerCase().includes(query)));
});
const current = computed(() => visibleSections.value.find((section) => section.id === selected.value) ?? visibleSections.value[0]);
const modes: ThemePreference[] = ['system', 'light', 'dark'];
const colorKeys: AppearanceColor[] = ['accent', 'background', 'foreground'];
const drafts = ref({ ...props.colors });
watch(() => props.colors, (value) => { drafts.value = { ...value }; }, { deep: true });
const validColor = (value: string) => /^#[\da-f]{6}$/i.test(value);
function changeColor(key: AppearanceColor, value: string): void {
  drafts.value[key] = value;
  if (validColor(value)) emit('changeColor', key, value.toLowerCase());
}
function selectSection(id: Section): void {
  selected.value = id;
  void nextTick(() => heading.value?.focus());
}
onMounted(() => heading.value?.focus());
</script>

<template>
  <section class="settings-view" data-testid="settings-view" :aria-label="t('settings.title')">
    <div class="settings-page">
      <header class="settings-page__header">
        <img class="settings-page__mark" :src="brandMark" alt="" aria-hidden="true" draggable="false" />
        <div class="settings-page__heading">
          <h1 ref="heading" class="settings-page__title" tabindex="-1">{{ t('settings.title') }}</h1>
          <p class="settings-page__subtitle">{{ t('settings.subtitle') }}</p>
        </div>
        <div class="settings-page__actions">
          <label class="settings-search"><Search :size="16" aria-hidden="true" /><input v-model="search" type="search" :aria-label="t('settings.search')" :placeholder="t('settings.search')" /></label>
          <button class="settings-back" type="button" data-action="settings-back" @click="emit('back')"><ArrowLeft :size="16" aria-hidden="true" />{{ t('settings.back') }}</button>
        </div>
      </header>

      <aside class="settings-sidebar">
        <nav :aria-label="t('settings.sections')" class="settings-sections">
          <button v-for="section in visibleSections" :key="section.id" type="button" :data-section="section.id" :data-action="`settings-section-${section.id}`" :aria-current="current?.id === section.id ? 'page' : undefined" @click="selectSection(section.id)">
            <component :is="section.icon" :size="17" aria-hidden="true" />{{ t(`settings.${section.id}`) }}
          </button>
        </nav>
      </aside>

      <main class="settings-content">
        <template v-if="current">
          <template v-if="current.id === 'appearance'">
            <section class="settings-card settings-theme-picker" :aria-label="t('settings.theme')">
              <header class="settings-card__header"><h2>{{ t('settings.theme') }}</h2></header>
              <div class="settings-theme-options">
                <button v-for="mode in modes" :key="mode" type="button" :data-theme-choice="mode" :data-action="`theme-${mode}`" :aria-pressed="preference === mode" @click="emit('changeTheme', mode)">
                  <span class="settings-theme-preview" :class="`settings-theme-preview--${mode}`" aria-hidden="true"><span class="settings-theme-preview__toolbar" /><span class="settings-theme-preview__window"><i /><i /><i /></span><span v-if="mode === 'system'" class="settings-theme-preview__split" /></span>
                  <span class="settings-theme-options__label">{{ t(`settings.${mode}`) }}</span>
                </button>
              </div>
            </section>
            <section class="settings-card" :aria-label="t('settings.colors')">
              <header class="settings-card__header"><h2>{{ t(theme === 'light' ? 'settings.lightColors' : 'settings.darkColors') }}</h2><button type="button" class="settings-text-button" data-action="reset-colors" @click="emit('resetColors')">{{ t('settings.reset') }}</button></header>
              <p class="settings-card__note">{{ t('settings.perTheme') }}</p>
              <div class="settings-rows">
                <div class="settings-row" :class="{ 'settings-row--modified': colorScheme !== 'pink' }"><label for="settings-color-scheme">{{ t('header.colorScheme') }}</label><select id="settings-color-scheme" :value="colorScheme" data-testid="settings-color-scheme" @change="emit('changeColorScheme', ($event.target as HTMLSelectElement).value as ColorScheme)"><option v-for="option in colorSchemeOptions" :key="option.id" :value="option.id">{{ t(`colorScheme.${option.id}`) }}</option></select></div>
                <div v-for="key in colorKeys" :key="key" class="settings-row" :class="{ 'settings-row--modified': customized?.[key] }"><label :for="`settings-${key}`">{{ t(`settings.${key}`) }}</label><div class="settings-color-control"><input type="color" :value="colors[key]" :aria-label="t(`settings.${key}`)" @input="changeColor(key, ($event.target as HTMLInputElement).value)" /><input :id="`settings-${key}`" :data-color="key" :value="drafts[key]" :aria-invalid="!validColor(drafts[key])" :aria-describedby="!validColor(drafts[key]) ? 'settings-color-error' : undefined" spellcheck="false" maxlength="7" @input="changeColor(key, ($event.target as HTMLInputElement).value)" /></div></div>
              </div>
              <p v-if="colorKeys.some((key) => !validColor(drafts[key]))" id="settings-color-error" class="settings-error" role="alert">{{ t('settings.invalidColor') }}</p>
              <p class="settings-card__note">{{ t('settings.contrast') }}</p>
            </section>
          </template>
          <section v-else-if="current.id === 'general'" class="settings-card">
            <header class="settings-card__header"><h2>{{ t('settings.general') }}</h2></header>
            <div class="settings-rows">
              <div class="settings-row"><span>{{ t('locale.label') }}</span><LocaleSwitcher :locale="locale" :t="t" @change="emit('changeLocale', $event)" /></div>
              <button class="settings-link-row" type="button" data-action="open-setup-guide" data-testid="settings-open-setup" @click="emit('openSetup')"><BookOpen :size="18" aria-hidden="true" />{{ t('setup.guide') }}<span aria-hidden="true">→</span></button>
              <button class="settings-link-row" type="button" data-action="open-github" @click="emit('openGithub')"><ExternalLink :size="18" aria-hidden="true" />{{ t('header.github') }}<span aria-hidden="true">↗</span></button>
            </div>
          </section>
          <section v-else-if="current.id === 'connection'" class="settings-card">
            <header class="settings-card__header"><h2>{{ t('settings.connection') }}</h2></header>
            <div class="settings-rows">
              <div class="settings-row"><span>{{ t('settings.connectionStatus') }}</span><span class="settings-connection" :data-state="connectionState"><i aria-hidden="true" />{{ t(`connection.${connectionState}`) }}</span></div>
              <div class="settings-row settings-row--endpoint"><div><h3>{{ t('apiEndpoint.title') }}</h3><p>{{ apiEndpoint || t('settings.defaultEndpoint') }}</p></div><button type="button" class="settings-text-button" data-action="open-api-endpoint" @click="emit('openApiEndpoint')">{{ t('settings.configure') }}</button></div>
            </div>
          </section>
          <section v-else class="settings-card">
            <header class="settings-card__header"><h2>{{ t('settings.workbench') }}</h2></header>
            <div class="settings-rows">
              <button class="settings-link-row" type="button" data-action="settings-show-history" @click="emit('showHistory')"><Clock :size="18" aria-hidden="true" />{{ t('header.history.show') }}<span aria-hidden="true">→</span></button>
              <button class="settings-link-row" type="button" data-action="settings-show-inspector" @click="emit('showInspector')"><Info :size="18" aria-hidden="true" />{{ t('header.inspector.show') }}<span aria-hidden="true">→</span></button>
            </div>
          </section>
        </template>
        <p v-else class="settings-empty" role="status">{{ t('settings.noResults') }}</p>
      </main>
    </div>
  </section>
</template>

<style src="../styles/settings.css"></style>
