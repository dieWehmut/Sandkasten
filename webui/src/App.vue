<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue';
import AppHeader from './components/AppHeader.vue';
import SetupWelcome from './components/SetupWelcome.vue';
import WorkbenchShell from './components/WorkbenchShell.vue';
import { useLocale } from './composables/useLocale';
import { useSetupWelcome } from './composables/useSetupWelcome';
import { useRunner } from './composables/useRunner';
import { useTheme } from './composables/useTheme';
import { useMediaLayout } from './composables/useMediaLayout';
import { TRANSLATOR_KEY } from './i18n/useTranslation';

const runner = useRunner();
const theme = useTheme();
const layout = useMediaLayout();
const locale = useLocale();
const setupWelcome = useSetupWelcome();
const historyOpen = ref(layout.isDesktop.value);
const inspectorOpen = ref(layout.isDesktop.value);
const runnerLoaded = ref(false);

provide(TRANSLATOR_KEY, locale.t);

const selectedRuntime = computed(() => runner.runtimes.value.find((runtime) => runtime.language === runner.selectedLanguage.value));
const canRun = computed(() => runner.connectionState.value === 'connected'
  && Boolean(runner.selectedLanguage.value)
  && Boolean(runner.source.value.trim())
  && !['booting', 'submitting', 'polling'].includes(runner.phase.value));

function openGithub(): void {
  window.open('https://github.com/dieWehmut/Sandkasten', '_blank', 'noopener,noreferrer');
}

function loadRunnerOnce(): void {
  if (runnerLoaded.value) return;
  runnerLoaded.value = true;
  void runner.load();
}

function dismissSetup(): void {
  setupWelcome.dismiss();
  loadRunnerOnce();
}

function toggleHistory(): void {
  const nextOpen = !historyOpen.value;
  historyOpen.value = nextOpen;
  if (layout.isCompact.value && nextOpen) inspectorOpen.value = false;
}

function toggleInspector(): void {
  const nextOpen = !inspectorOpen.value;
  inspectorOpen.value = nextOpen;
  if (layout.isCompact.value && nextOpen) historyOpen.value = false;
}

watch(layout.mode, (mode, previousMode) => {
  if (mode === 'desktop') {
    historyOpen.value = true;
    inspectorOpen.value = true;
  } else if (previousMode === 'desktop') {
    historyOpen.value = false;
    inspectorOpen.value = false;
  }
});

onMounted(() => {
  if (!setupWelcome.isGuideOpen.value) loadRunnerOnce();
});
onBeforeUnmount(() => {
  theme.dispose();
  layout.dispose();
});
</script>

<template>
  <div class="workbench-app" data-testid="app-shell">
    <AppHeader
      v-if="!setupWelcome.isGuideOpen.value"
      :connection-state="runner.connectionState.value"
      :history-open="historyOpen"
      :inspector-open="inspectorOpen"
      :theme="theme.theme.value"
      :locale="locale.locale.value"
      :t="locale.t"
      @toggle-history="toggleHistory"
      @toggle-inspector="toggleInspector"
      @toggle-theme="theme.toggleTheme"
      @open-github="openGithub"
      @open-setup="setupWelcome.reopen"
      @change-locale="locale.setLocale"
    />
    <SetupWelcome
      v-if="setupWelcome.isGuideOpen.value"
      :t="locale.t"
      :locale="locale.locale.value"
      @change-locale="locale.setLocale"
      @dismiss="dismissSetup"
    />
    <section v-else-if="runner.connectionState.value === 'unavailable'" class="connection-error" role="alert">
      <span>{{ runner.error.value }}</span>
      <button type="button" @click="runner.load">{{ locale.t('connection.retry') }}</button>
    </section>
    <WorkbenchShell
      v-if="!setupWelcome.isGuideOpen.value"
      :history-open="historyOpen"
      :inspector-open="inspectorOpen"
      :layout-mode="layout.mode.value"
      :history="runner.history.value"
      :runtimes="runner.runtimes.value"
      :runtime="selectedRuntime"
      :language="runner.selectedLanguage.value"
      :source="runner.source.value"
      :phase="runner.phase.value"
      :current-job="runner.currentJob.value"
      :result="runner.result.value"
      :error="runner.requestError.value"
      :polling-stopped="runner.pollingStopped.value"
      :active-output-tab="runner.activeOutputTab.value"
      :can-run="canRun"
      :can-resume="runner.canResumePolling.value"
      @select-history="runner.selectHistoryItem"
      @update:language="runner.setLanguage"
      @update:source="runner.setSource"
      @update:active-output-tab="runner.setActiveOutputTab"
      @run="runner.submit"
      @stop="runner.stopPolling"
      @resume="runner.resumePolling"
      @close-history="historyOpen = false"
      @close-inspector="inspectorOpen = false"
    />
  </div>
</template>
