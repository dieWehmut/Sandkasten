<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { ArrowLeft, BookOpen, Clock, Code, ExternalLink, Files, Info, Palette, RotateCcw, Search, Server, Settings } from '@lucide/vue';
import type { AppearanceColor, AppearanceColors } from '../composables/useAppearance';
import type { Theme, ThemePreference } from '../composables/useTheme';
import type { ConnectionState } from '../composables/useRunner';
import type { Locale, Translator } from '../i18n/locale';
import type { MessageKey } from '../i18n/messages';
import { DEFAULT_EDITOR_SETTINGS, DEFAULT_FILE_SETTINGS, DEFAULT_WORKBENCH_SETTINGS, normalizeUserSettings, type EditorSettings, type FileSettings, type UserSettings, type WorkbenchSettings } from '../state/editorSettings';
import { colorSchemeOptions, type ColorScheme } from '../theme/colorScheme';
import LocaleSwitcher from './LocaleSwitcher.vue';

const props = defineProps<{
  preference: ThemePreference; theme: Theme; colors: AppearanceColors; colorScheme: ColorScheme;
  locale: Locale; t: Translator; connectionState: ConnectionState; apiEndpoint: string;
  customized?: Partial<Record<AppearanceColor, boolean>>;
  userSettings?: UserSettings;
}>();
const emit = defineEmits<{
  back: []; changeTheme: [value: ThemePreference]; changeColor: [key: AppearanceColor, value: string];
  resetColors: []; changeColorScheme: [value: ColorScheme]; changeLocale: [value: Locale];
  changeEditorSetting: [key: keyof EditorSettings, value: EditorSettings[keyof EditorSettings]];
  changeFileSetting: [key: keyof FileSettings, value: FileSettings[keyof FileSettings]];
  changeWorkbenchSetting: [key: keyof WorkbenchSettings, value: boolean];
  openApiEndpoint: []; openSetup: []; showHistory: []; showInspector: []; openGithub: [];
}>();
type Section = 'general' | 'appearance' | 'editor' | 'files' | 'connection' | 'workbench';
type PreferenceGroup = 'editor' | 'files' | 'workbench';
interface PreferenceRow {
  group: PreferenceGroup;
  key: keyof EditorSettings | keyof FileSettings | keyof WorkbenchSettings;
  id: string;
  label: MessageKey;
  description: MessageKey;
  kind: 'number' | 'boolean' | 'select';
  min?: number;
  max?: number;
}
const row = (group: PreferenceGroup, key: PreferenceRow['key'], id: string, kind: PreferenceRow['kind'], min?: number, max?: number): PreferenceRow => ({
  group, key, id, kind, min, max, label: `settings.${key}` as MessageKey, description: `settings.${key}Description` as MessageKey,
});
const preferenceRows: PreferenceRow[] = [
  row('editor', 'fontSize', 'editor.fontSize', 'number', 10, 32),
  row('editor', 'wordWrap', 'editor.wordWrap', 'boolean'),
  row('editor', 'tabSize', 'editor.tabSize', 'number', 1, 8),
  row('editor', 'insertSpaces', 'editor.insertSpaces', 'boolean'),
  row('editor', 'lineNumbers', 'editor.lineNumbers', 'boolean'),
  row('editor', 'minimap', 'editor.minimap.enabled', 'boolean'),
  row('editor', 'indentGuides', 'editor.guides.indentation', 'boolean'),
  row('editor', 'quickSuggestions', 'editor.quickSuggestions', 'boolean'),
  row('files', 'autoSave', 'files.autoSave', 'select'),
  row('files', 'autoSaveDelay', 'files.autoSaveDelay', 'number', 100, 10000),
  row('workbench', 'sidebarVisible', 'workbench.sideBar.visible', 'boolean'),
  row('workbench', 'panelVisible', 'workbench.panel.visible', 'boolean'),
];
const search = ref('');
const selected = ref<Section>('appearance');
const heading = ref<HTMLElement>();
const sections: { id: Section; icon: typeof Settings; keys: MessageKey[] }[] = [
  { id: 'general', icon: Settings, keys: ['locale.label', 'setup.guide', 'header.github'] },
  { id: 'appearance', icon: Palette, keys: ['settings.theme', 'settings.system', 'settings.light', 'settings.dark', 'settings.accent', 'settings.background', 'settings.foreground', 'header.colorScheme'] },
  { id: 'editor', icon: Code, keys: [] },
  { id: 'files', icon: Files, keys: [] },
  { id: 'connection', icon: Server, keys: ['apiEndpoint.title', 'apiEndpoint.label', 'settings.connectionStatus'] },
  { id: 'workbench', icon: Info, keys: ['header.history.show', 'header.inspector.show'] },
];
const values = computed(() => props.userSettings ?? normalizeUserSettings());
const defaults = { editor: DEFAULT_EDITOR_SETTINGS, files: DEFAULT_FILE_SETTINGS, workbench: DEFAULT_WORKBENCH_SETTINGS };
function valueOf(item: PreferenceRow): number | boolean | string {
  return (values.value[item.group] as unknown as Record<string, number | boolean | string>)[item.key];
}
function defaultOf(item: PreferenceRow): number | boolean | string {
  return (defaults[item.group] as unknown as Record<string, number | boolean | string>)[item.key];
}
const onlyModified = computed(() => /(?:^|\s)@modified(?:\s|$)/i.test(search.value));
const queryTerms = computed(() => search.value.replace(/(?:^|\s)@modified(?=\s|$)/gi, ' ').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean));
function matches(keys: MessageKey[], modified = false, id = '', section?: Section): boolean {
  if (onlyModified.value && !modified) return false;
  const text = [id, ...keys.map(props.t), section ? props.t(`settings.${section}`) : ''].join(' ').toLocaleLowerCase();
  return queryTerms.value.every((term) => text.includes(term));
}
function visibleRows(section: Section): PreferenceRow[] {
  return preferenceRows.filter((item) => item.group === section && matches([item.label, item.description], valueOf(item) !== defaultOf(item), item.id, section));
}
function existingCount(section: Section): number {
  if (section === 'general') return Number(matches(['locale.label'], props.locale !== 'en', 'workbench.language', section)) + Number(matches(['setup.guide'], false, '', section)) + Number(matches(['header.github'], false, '', section));
  if (section === 'appearance') return Number(matches(['settings.theme', 'settings.system', 'settings.light', 'settings.dark'], props.preference !== 'system', 'workbench.colorTheme', section)) + Number(matches(['header.colorScheme'], props.colorScheme !== 'pink', 'workbench.colorScheme', section)) + colorKeys.filter((key) => matches([`settings.${key}`], Boolean(props.customized?.[key]), `workbench.colorCustomizations.${key}`, section)).length;
  if (section === 'connection') return Number(matches(['settings.connectionStatus'], false, '', section)) + Number(matches(['apiEndpoint.title', 'apiEndpoint.label'], Boolean(props.apiEndpoint), 'connection.apiEndpoint', section));
  if (section === 'workbench') return Number(matches(['header.history.show'], false, '', section)) + Number(matches(['header.inspector.show'], false, '', section));
  return 0;
}
const visibleSections = computed(() => sections.filter((section) => existingCount(section.id) + visibleRows(section.id).length > 0));
const current = computed(() => visibleSections.value.find((section) => section.id === selected.value) ?? visibleSections.value[0]);
const searching = computed(() => Boolean(search.value.trim()));
const renderedSections = computed(() => searching.value ? visibleSections.value : current.value ? [current.value] : []);
const resultCount = computed(() => visibleSections.value.reduce((total, section) => total + existingCount(section.id) + visibleRows(section.id).length, 0));
const modes: ThemePreference[] = ['system', 'light', 'dark'];
const colorKeys: AppearanceColor[] = ['accent', 'background', 'foreground'];
const drafts = ref({ ...props.colors });
const numberDrafts = ref<Record<string, string>>({});
watch(() => props.colors, (value) => { drafts.value = { ...value }; }, { deep: true });
watch(values, () => {
  for (const item of preferenceRows) if (item.kind === 'number') numberDrafts.value[item.id] = String(valueOf(item));
}, { deep: true, immediate: true });
const validColor = (value: string) => /^#[\da-f]{6}$/i.test(value);
function validNumber(item: PreferenceRow): boolean {
  const draft = numberDrafts.value[item.id];
  const value = Number(draft);
  return draft.trim() !== '' && Number.isInteger(value) && value >= (item.min ?? 0) && value <= (item.max ?? Infinity);
}
function changeColor(key: AppearanceColor, value: string): void {
  drafts.value[key] = value;
  if (validColor(value)) emit('changeColor', key, value.toLowerCase());
}
function changePreference(item: PreferenceRow, value: number | boolean | string): void {
  if (item.group === 'editor') emit('changeEditorSetting', item.key as keyof EditorSettings, value as number | boolean);
  else if (item.group === 'files') emit('changeFileSetting', item.key as keyof FileSettings, value as FileSettings[keyof FileSettings]);
  else emit('changeWorkbenchSetting', item.key as keyof WorkbenchSettings, Boolean(value));
}
function changeNumber(item: PreferenceRow, value: string): void {
  numberDrafts.value[item.id] = value;
  if (validNumber(item)) changePreference(item, Number(value));
}
function resetPreference(item: PreferenceRow): void {
  numberDrafts.value[item.id] = String(defaultOf(item));
  changePreference(item, defaultOf(item));
}
function toggleModified(): void {
  search.value = onlyModified.value ? search.value.replace(/(?:^|\s)@modified(?=\s|$)/gi, ' ').trim() : `@modified ${search.value}`.trim();
}
function formatMessage(key: MessageKey, parameters: Record<string, number>): string {
  return props.t(key).replace(/\{(\w+)\}/g, (placeholder, name: string) => String(parameters[name] ?? placeholder));
}
function selectSection(id: Section): void {
  selected.value = id;
  if (searching.value) document.querySelector<HTMLElement>(`[data-settings-group="${id}"]`)?.scrollIntoView?.({ block: 'start' });
  else void nextTick(() => heading.value?.focus());
}
onMounted(() => heading.value?.focus());
</script>

<template>
  <section class="settings-view" data-testid="settings-view" :aria-label="t('settings.title')">
    <aside class="settings-sidebar">
      <button class="settings-back" type="button" data-action="settings-back" @click="emit('back')"><ArrowLeft :size="19" aria-hidden="true" />{{ t('settings.back') }}</button>
      <nav :aria-label="t('settings.sections')" class="settings-sections">
        <button v-for="section in visibleSections" :key="section.id" type="button" :data-section="section.id" :data-action="`settings-section-${section.id}`" :aria-current="current?.id === section.id ? 'page' : undefined" @click="selectSection(section.id)">
          <component :is="section.icon" :size="19" aria-hidden="true" />{{ t(`settings.${section.id}`) }}
          <span v-if="searching" class="settings-section-count">{{ existingCount(section.id) + visibleRows(section.id).length }}</span>
        </button>
      </nav>
    </aside>
    <main class="settings-content">
      <header class="settings-header">
        <div class="settings-header__row">
          <h1 ref="heading" tabindex="-1">{{ searching || !current ? t('settings.title') : t(`settings.${current.id}`) }}</h1>
          <label class="settings-search"><Search :size="18" aria-hidden="true" /><input v-model="search" type="search" :aria-label="t('settings.search')" :placeholder="t('settings.search')" /></label>
        </div>
        <div class="settings-header__controls"><button type="button" data-action="settings-filter-modified" :aria-pressed="onlyModified" @click="toggleModified">{{ t('settings.modified') }}</button><span v-if="searching && resultCount" role="status">{{ formatMessage('settings.searchResults', { count: resultCount }) }}</span></div>
      </header>
      <div class="settings-content__inner">
        <section v-for="section in renderedSections" :key="section.id" :data-settings-group="section.id" class="settings-group">
          <h2 v-if="searching" class="settings-group-title">{{ t(`settings.${section.id}`) }}</h2>
          <template v-if="section.id === 'appearance'">
            <fieldset v-if="matches(['settings.theme', 'settings.system', 'settings.light', 'settings.dark'], preference !== 'system', 'workbench.colorTheme', 'appearance')" class="settings-theme-picker"><legend>{{ t('settings.theme') }}</legend>
              <div class="settings-theme-options">
                <button v-for="mode in modes" :key="mode" type="button" :data-theme-choice="mode" :data-action="`theme-${mode}`" :aria-pressed="preference === mode" @click="emit('changeTheme', mode)">
                  <span class="settings-theme-preview" :class="`settings-theme-preview--${mode}`" aria-hidden="true"><span class="settings-theme-preview__toolbar" /><span class="settings-theme-preview__window"><i /><i /><i /></span><span v-if="mode === 'system'" class="settings-theme-preview__split" /></span><span>{{ t(`settings.${mode}`) }}</span>
                </button>
              </div>
            </fieldset>
            <section v-if="existingCount('appearance') > Number(matches(['settings.theme', 'settings.system', 'settings.light', 'settings.dark'], preference !== 'system', 'workbench.colorTheme', 'appearance'))" class="settings-card" :aria-label="t('settings.colors')">
              <header class="settings-card__header"><div><h2>{{ t(theme === 'light' ? 'settings.lightColors' : 'settings.darkColors') }}</h2><p>{{ t('settings.perTheme') }}</p></div><button type="button" class="settings-text-button" data-action="reset-colors" @click="emit('resetColors')">{{ t('settings.reset') }}</button></header>
              <label v-if="matches(['header.colorScheme'], colorScheme !== 'pink', 'workbench.colorScheme', 'appearance')" class="settings-row" :class="{ 'settings-row--modified': colorScheme !== 'pink' }"><span>{{ t('header.colorScheme') }}</span><select :value="colorScheme" data-testid="settings-color-scheme" @change="emit('changeColorScheme', ($event.target as HTMLSelectElement).value as ColorScheme)"><option v-for="option in colorSchemeOptions" :key="option.id" :value="option.id">{{ t(`colorScheme.${option.id}`) }}</option></select></label>
              <template v-for="key in colorKeys" :key="key"><div v-if="matches([`settings.${key}`], Boolean(customized?.[key]), `workbench.colorCustomizations.${key}`, 'appearance')" class="settings-row" :class="{ 'settings-row--modified': customized?.[key] }"><label :for="`settings-${key}`">{{ t(`settings.${key}`) }}</label><div class="settings-color-control"><input type="color" :value="colors[key]" :aria-label="t(`settings.${key}`)" @input="changeColor(key, ($event.target as HTMLInputElement).value)" /><input :id="`settings-${key}`" :data-color="key" :value="drafts[key]" :aria-invalid="!validColor(drafts[key])" :aria-describedby="!validColor(drafts[key]) ? 'settings-color-error' : undefined" spellcheck="false" maxlength="7" @input="changeColor(key, ($event.target as HTMLInputElement).value)" /></div></div></template>
              <p v-if="colorKeys.some((key) => !validColor(drafts[key]))" id="settings-color-error" class="settings-error" role="alert">{{ t('settings.invalidColor') }}</p><p class="settings-card__note">{{ t('settings.contrast') }}</p>
            </section>
          </template>
          <section v-if="section.id === 'general'" class="settings-card">
            <div v-if="matches(['locale.label'], locale !== 'en', 'workbench.language', 'general')" class="settings-row" :class="{ 'settings-row--modified': locale !== 'en' }"><span>{{ t('locale.label') }}</span><LocaleSwitcher :locale="locale" :t="t" @change="emit('changeLocale', $event)" /></div>
            <button v-if="matches(['setup.guide'], false, '', 'general')" class="settings-link-row" type="button" data-action="open-setup-guide" data-testid="settings-open-setup" @click="emit('openSetup')"><BookOpen :size="19" aria-hidden="true" />{{ t('setup.guide') }}<span aria-hidden="true">→</span></button>
            <button v-if="matches(['header.github'], false, '', 'general')" class="settings-link-row" type="button" data-action="open-github" @click="emit('openGithub')"><ExternalLink :size="19" aria-hidden="true" />{{ t('header.github') }}<span aria-hidden="true">↗</span></button>
          </section>
          <section v-if="section.id === 'connection'" class="settings-card">
            <div v-if="matches(['settings.connectionStatus'], false, '', 'connection')" class="settings-row"><span>{{ t('settings.connectionStatus') }}</span><span class="settings-connection" :data-state="connectionState"><i aria-hidden="true" />{{ t(`connection.${connectionState}`) }}</span></div>
            <div v-if="matches(['apiEndpoint.title', 'apiEndpoint.label'], Boolean(apiEndpoint), 'connection.apiEndpoint', 'connection')" class="settings-row settings-row--endpoint" :class="{ 'settings-row--modified': apiEndpoint }"><div><h2>{{ t('apiEndpoint.title') }}</h2><p>{{ apiEndpoint || t('settings.defaultEndpoint') }}</p></div><button type="button" class="settings-text-button" data-action="open-api-endpoint" @click="emit('openApiEndpoint')">{{ t('settings.configure') }}</button></div>
          </section>
          <div v-for="item in visibleRows(section.id)" :key="item.id" class="settings-row settings-preference" :class="{ 'settings-row--modified': valueOf(item) !== defaultOf(item) }" :data-setting-row="item.id">
            <div class="settings-preference__copy"><label :for="`settings-${item.id}`">{{ t(item.label) }}</label><code>{{ item.id }}</code><p :id="`settings-description-${item.id}`">{{ t(item.description) }}</p></div>
            <div class="settings-preference__control">
              <input v-if="item.kind === 'boolean'" :id="`settings-${item.id}`" type="checkbox" :data-setting="item.id" :checked="Boolean(valueOf(item))" :aria-describedby="`settings-description-${item.id}`" @change="changePreference(item, ($event.target as HTMLInputElement).checked)" />
              <template v-else-if="item.kind === 'number'"><input :id="`settings-${item.id}`" type="number" :data-setting="item.id" :value="numberDrafts[item.id]" :min="item.min" :max="item.max" step="1" :aria-invalid="!validNumber(item)" :aria-describedby="`settings-description-${item.id}${!validNumber(item) ? ` settings-error-${item.id}` : ''}`" @input="changeNumber(item, ($event.target as HTMLInputElement).value)" /><p v-if="!validNumber(item)" :id="`settings-error-${item.id}`" class="settings-error" role="alert">{{ formatMessage('settings.invalidNumber', { min: item.min ?? 0, max: item.max ?? 0 }) }}</p></template>
              <select v-else :id="`settings-${item.id}`" :data-setting="item.id" :value="valueOf(item)" :aria-describedby="`settings-description-${item.id}`" @change="changePreference(item, ($event.target as HTMLSelectElement).value)"><option value="off">{{ t('settings.autoSaveOff') }}</option><option value="afterDelay">{{ t('settings.autoSaveAfterDelay') }}</option><option value="onFocusChange">{{ t('settings.autoSaveOnFocusChange') }}</option></select>
              <button v-if="valueOf(item) !== defaultOf(item)" type="button" class="settings-reset-setting" :data-reset-setting="item.id" :title="t('settings.resetSetting')" :aria-label="`${t('settings.resetSetting')}: ${t(item.label)}`" @click="resetPreference(item)"><RotateCcw :size="14" aria-hidden="true" /></button>
            </div>
          </div>
          <section v-if="section.id === 'workbench'" class="settings-card">
            <button v-if="matches(['header.history.show'], false, '', 'workbench')" class="settings-link-row" type="button" data-action="settings-show-history" @click="emit('showHistory')"><Clock :size="19" aria-hidden="true" />{{ t('header.history.show') }}<span aria-hidden="true">→</span></button>
            <button v-if="matches(['header.inspector.show'], false, '', 'workbench')" class="settings-link-row" type="button" data-action="settings-show-inspector" @click="emit('showInspector')"><Info :size="19" aria-hidden="true" />{{ t('header.inspector.show') }}<span aria-hidden="true">→</span></button>
          </section>
        </section>
        <p v-if="!renderedSections.length" class="settings-empty" role="status">{{ t('settings.noResults') }}</p>
      </div>
    </main>
  </section>
</template>

<style src="../styles/settings.css"></style>
