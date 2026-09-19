<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue';
import AppHeader from './components/AppHeader.vue';
import ApiEndpointDialog from './components/ApiEndpointDialog.vue';
import SetupWelcome from './components/SetupWelcome.vue';
import WorkbenchShell from './components/WorkbenchShell.vue';
import { useLocale } from './composables/useLocale';
import { useSetupWelcome } from './composables/useSetupWelcome';
import { useRunner, type OutputTab } from './composables/useRunner';
import { useLocalRunner } from './composables/useLocalRunner';
import { useRunHistory } from './composables/useRunHistory';
import { useWorkspace } from './composables/useWorkspace';
import { useIdeLayout } from './composables/useIdeLayout';
import { isExecutionBusy, type ExecutionBackend, type ExecutionPhase } from './composables/execution';
import { useTheme } from './composables/useTheme';
import { useColorScheme } from './composables/useColorScheme';
import { useMediaLayout } from './composables/useMediaLayout';
import { isTerminalShortcut, useTerminal } from './composables/useTerminal';
import { desktopBridge } from './services/desktopBridge';
import { readConfiguredApiBaseUrl, saveConfiguredApiBaseUrl } from './services/apiEndpoint';
import { windowTitle } from './editor/windowTitle';
import { statusLabel } from './state/status';
import type { MessageKey } from './i18n/messages';
import { TRANSLATOR_KEY } from './i18n/useTranslation';

const bridge = desktopBridge();
const terminal = bridge?.terminal ? useTerminal(bridge.terminal) : undefined;
const runHistory = useRunHistory(20);
const runner = useRunner({ history: runHistory });
const local = useLocalRunner({ bridge, history: runHistory });
const workspace = useWorkspace();
const ide = useIdeLayout();
const theme = useTheme();
const colorScheme = useColorScheme();
const layout = useMediaLayout();
const locale = useLocale();
const setupWelcome = useSetupWelcome();
const compactHistoryOpen = ref(layout.isDesktop.value);
const compactInspectorOpen = ref(layout.isDesktop.value);
const runnerLoaded = ref(false);
const backend = ref<ExecutionBackend>('api');
const cursor = ref({ line: 1, column: 1 });
const creatingFile = ref(false);
// The token lets a repeated click on the same folder re-open it after the user
// folded it again; a bare path would not change and the watcher would stay put.
const revealRequest = ref<{ path: string; token: number }>();
let revealToken = 0;
const apiEndpointOpen = ref(false);
const configuredApiBaseUrl = ref(readConfiguredApiBaseUrl());

provide(TRANSLATOR_KEY, locale.t);

const PHASE_KEYS: Readonly<Record<ExecutionPhase, MessageKey>> = {
  booting: 'phase.booting',
  ready: 'phase.ready',
  submitting: 'phase.submitting',
  polling: 'phase.polling',
  stopped: 'phase.stopped',
  completed: 'phase.completed',
  error: 'phase.error',
  running: 'phase.running',
  unavailable: 'phase.unavailable',
};

const activeFile = workspace.activeFile;
// The document title names the open file and workspace, so the desktop window
// and a browser tab both identify what is being edited rather than the app
// alone.
const documentTitle = computed(() => windowTitle({
  appName: locale.t('brand.name'),
  workspace: workspace.root.value?.name,
  file: activeFile.value?.name,
  dirty: activeFile.value?.dirty,
}));
const language = computed(() => activeFile.value?.language || runner.selectedLanguage.value);
const source = computed(() => activeFile.value?.source ?? '');
// Both desktop backends share one controller, so only the API backend reads
// from `useRunner`.
const usesDesktop = computed(() => backend.value !== 'api');
const executionPhase = computed<ExecutionPhase>(() => (usesDesktop.value ? local.phase.value : runner.phase.value));
const result = computed(() => (usesDesktop.value ? local.result.value : runner.result.value));
const currentJob = computed(() => (usesDesktop.value ? local.result.value : runner.currentJob.value));
const requestError = computed(() => (usesDesktop.value ? local.error.value : runner.requestError.value));
const pollingStopped = computed(() => !usesDesktop.value && runner.pollingStopped.value);
const connectionState = computed(() => (usesDesktop.value ? 'connected' as const : runner.connectionState.value));
const selectedRuntime = computed(() => runner.runtimes.value.find((runtime) => runtime.language === language.value));
const localReady = computed(() => local.available.value && local.supports(language.value));
const isolatedReady = computed(() => local.available.value && local.supportsIsolated(language.value));

const canRun = computed(() => {
  if (!activeFile.value || !source.value.trim() || isExecutionBusy(executionPhase.value)) return false;
  if (executionPhase.value === 'booting' || executionPhase.value === 'unavailable') return false;
  if (backend.value === 'local') return localReady.value;
  if (backend.value === 'isolated') return isolatedReady.value;
  return runner.connectionState.value === 'connected' && Boolean(language.value);
});
const canResume = computed(() => backend.value === 'api' && runner.canResumePolling.value);
const statusText = computed(() => {
  const job = result.value;
  if (job?.status) return statusLabel(job.status, locale.t);
  return locale.t(PHASE_KEYS[executionPhase.value]);
});
const ideMode = computed(() => layout.isDesktop.value);
const historyOpen = computed(() => (ideMode.value
  ? ide.sidebarVisible.value && ide.activity.value === 'runs'
  : compactHistoryOpen.value));
const inspectorOpen = computed(() => (ideMode.value
  ? ide.sidebarVisible.value && ide.activity.value === 'context'
  : compactInspectorOpen.value));

function openGithub(): void {
  window.open('https://github.com/dieWehmut/Sandkasten', '_blank', 'noopener,noreferrer');
}

function openApiEndpoint(): void {
  apiEndpointOpen.value = true;
}

// Saving a new endpoint updates the stored override and reloads the runtime
// list, because the previous runtimes came from the old origin.
function saveApiEndpoint(value: string): void {
  try {
    configuredApiBaseUrl.value = saveConfiguredApiBaseUrl(window.localStorage, value);
  } catch {
    configuredApiBaseUrl.value = value;
  }
  apiEndpointOpen.value = false;
  runnerLoaded.value = false;
  loadRunnerOnce();
}

function loadRunnerOnce(): void {
  if (runnerLoaded.value) return;
  runnerLoaded.value = true;
  void runner.load();
}

function dismissSetup(): void {
  setupWelcome.dismiss();
  loadRunnerOnce();
  void nextTick(() => {
    document.querySelector<HTMLElement>('[data-testid="open-setup-guide"]')?.focus();
  });
}

// In the editor-first layout the header buttons switch the sidebar section; only
// the activity bar, the sidebar's own collapse control, and Ctrl+B collapse it.
function toggleHistory(): void {
  if (ideMode.value) {
    ide.showActivity('runs');
    return;
  }
  const nextOpen = !compactHistoryOpen.value;
  compactHistoryOpen.value = nextOpen;
  if (layout.isCompact.value && nextOpen) compactInspectorOpen.value = false;
}

function toggleInspector(): void {
  if (ideMode.value) {
    ide.showActivity('context');
    return;
  }
  const nextOpen = !compactInspectorOpen.value;
  compactInspectorOpen.value = nextOpen;
  if (layout.isCompact.value && nextOpen) compactHistoryOpen.value = false;
}

function selectActivity(activity: Parameters<typeof ide.selectActivity>[0]): void {
  ide.selectActivity(activity);
}

function openFolder(): void {
  void workspace.openFolder();
}

function refreshTree(): void {
  void workspace.refreshTree();
}

function createFile(payload: { name: string; language: string }): void {
  void workspace.createFile(payload.name, payload.language)
    .then(() => { if (!language.value) runner.setLanguage(local.runtimes.value[0]?.language ?? ''); })
    .catch(() => undefined);
}

function removeFile(path: string): void {
  void workspace.removeFile(path);
}

function saveActive(): void {
  void workspace.saveActive();
}

function selectFile(path: string): void {
  void workspace.openFile(path);
}

// A breadcrumb step names a directory, so revealing it means showing the
// explorer with that folder unfolded rather than opening a file.
function revealInExplorer(path: string): void {
  ide.showActivity('explorer');
  revealToken += 1;
  revealRequest.value = { path, token: revealToken };
}

function closeFile(path: string): void {
  workspace.closeFile(path);
}

function updateSource(value: string): void {
  workspace.updateSource(value);
}

function updateLanguage(value: string): void {
  workspace.setLanguage(value);
  runner.setLanguage(value);
}

function updateBackend(value: ExecutionBackend): void {
  backend.value = value;
}

function selectHistoryItem(item: Parameters<typeof runner.selectHistoryItem>[0]): void {
  terminal?.showOutput();
  runner.selectHistoryItem(item);
  updateSource(item.source);
  updateLanguage(item.language);
  ide.showPanel();
}

async function runActive(): Promise<void> {
  const file = activeFile.value;
  if (!file || !canRun.value) return;
  terminal?.showOutput();
  ide.showPanel();
  cursor.value = { line: 1, column: 1 };
  if (usesDesktop.value) {
    if (workspace.isDesktop.value) {
      const saved = await workspace.saveActive();
      if (!saved) return;
    }
    const request = { path: file.path, language: language.value, source: file.source };
    if (backend.value === 'isolated') await local.runIsolated(request);
    else await local.run(request);
    return;
  }
  runner.setLanguage(language.value);
  runner.setSource(file.source);
  await runner.submit();
}

function stopActive(): void {
  if (usesDesktop.value) {
    void local.stop();
    return;
  }
  runner.stopPolling();
}

function resumeActive(): void {
  if (backend.value === 'api') void runner.resumePolling();
}

function setActiveOutputTab(tab: OutputTab): void {
  runner.setActiveOutputTab(tab);
}

function closeActiveFile(): void {
  if (workspace.activePath.value) workspace.closeFile(workspace.activePath.value);
}

function requestNewFile(): void {
  ide.showActivity('explorer');
  creatingFile.value = true;
}

async function openTerminal(mode: 'show' | 'new' | 'split' = 'show'): Promise<void> {
  if (!terminal) return;
  if (setupWelcome.isGuideOpen.value) dismissSetup();
  ide.showPanel();
  terminal.show();
  if (mode === 'split') await terminal.split();
  else if (mode === 'new' || (!terminal.sessions.value.length && !terminal.pending.value)) await terminal.create();
  await nextTick();
  terminal.focus();
}

function toggleTerminal(): void {
  if (!terminal) return;
  if (!setupWelcome.isGuideOpen.value && terminal.shown.value && ide.panelVisible.value) ide.togglePanel();
  else void openTerminal();
}

const MENU_COMMANDS: Readonly<Record<string, () => void>> = {
  'workspace.open': openFolder,
  'file.new': requestNewFile,
  'file.save': saveActive,
  'file.closeTab': closeActiveFile,
  'run.start': () => { void runActive(); },
  'run.stop': stopActive,
  'view.toggleSidebar': ide.toggleSidebar,
  'view.togglePanel': ide.togglePanel,
  'view.toggleSetup': setupWelcome.reopen,
  'apiEndpoint.open': openApiEndpoint,
  'theme.toggle': theme.toggleTheme,
  'help.github': openGithub,
  'terminal.new': () => { void openTerminal('new'); },
  'terminal.toggle': toggleTerminal,
  'terminal.split': () => { void openTerminal('split'); },
};

function onKeydown(event: KeyboardEvent): void {
  if (terminal && isTerminalShortcut(event)) {
    event.preventDefault();
    if (event.shiftKey) void openTerminal('new');
    else toggleTerminal();
    return;
  }
  if (event.target instanceof Element && event.target.closest('.terminal-panel')) return;
  if (!(event.ctrlKey || event.metaKey)) return;
  const key = event.key.toLowerCase();
  if (key === 's') {
    event.preventDefault();
    saveActive();
  } else if (key === 'enter') {
    event.preventDefault();
    void runActive();
  } else if (key === 'b') {
    event.preventDefault();
    ide.toggleSidebar();
  } else if (key === 'j') {
    event.preventDefault();
    ide.togglePanel();
  } else if (key === 'n') {
    event.preventDefault();
    requestNewFile();
  } else if (key === 'w') {
    event.preventDefault();
    closeActiveFile();
  }
}

watch(layout.mode, (mode, previousMode) => {
  if (mode === 'desktop') {
    compactHistoryOpen.value = true;
    compactInspectorOpen.value = true;
  } else if (previousMode === 'desktop') {
    compactHistoryOpen.value = false;
    compactInspectorOpen.value = false;
  }
});

watch(source, (value) => { runner.setSource(value); });
watch(language, (value) => { if (value) runner.setLanguage(value); });
watch(documentTitle, (value) => { document.title = value; }, { immediate: true });
watch(() => workspace.activePath.value, () => { cursor.value = { line: 1, column: 1 }; });
watch([theme.theme, colorScheme.colorScheme], () => { void nextTick(() => terminal?.syncTheme()); });

onMounted(() => {
  void terminal?.loadProfiles();
  if (!setupWelcome.isGuideOpen.value) loadRunnerOnce();
  window.addEventListener('keydown', onKeydown);
  bridge?.onMenuCommand?.((command) => MENU_COMMANDS[command]?.());
  void (async () => {
    await workspace.initialize();
    if (!bridge) return;
    await local.load();
    if (local.runtimes.value.some((runtime) => runtime.available)) backend.value = 'local';
  })();
});

onBeforeUnmount(() => {
  void terminal?.dispose();
  window.removeEventListener('keydown', onKeydown);
  theme.dispose();
  layout.dispose();
});
</script>

<template>
  <div
    class="workbench-app"
    :class="{ 'workbench-app--ide': layout.isDesktop.value, 'workbench-app--integrated': Boolean(bridge?.windowChrome?.integrated) }"
    data-testid="app-shell"
  >
    <AppHeader
      v-if="!setupWelcome.isGuideOpen.value"
      :connection-state="connectionState"
      :history-open="historyOpen"
      :inspector-open="inspectorOpen"
      :theme="theme.theme.value"
      :color-scheme="colorScheme.colorScheme.value"
      :locale="locale.locale.value"
      :t="locale.t"
      :window-title="documentTitle"
      :chrome="bridge?.windowChrome"
      :platform="bridge?.platform"
      @toggle-history="toggleHistory"
      @toggle-inspector="toggleInspector"
      @toggle-theme="theme.toggleTheme"
      @change-color-scheme="colorScheme.setColorScheme"
      @open-github="openGithub"
      @open-setup="setupWelcome.reopen"
      @open-api-endpoint="openApiEndpoint"
      @change-locale="locale.setLocale"
    />
    <ApiEndpointDialog
      :open="apiEndpointOpen"
      :value="configuredApiBaseUrl"
      :desktop="Boolean(bridge)"
      :t="locale.t"
      @save="saveApiEndpoint"
      @close="apiEndpointOpen = false"
    />
    <SetupWelcome
      v-if="setupWelcome.isGuideOpen.value"
      :t="locale.t"
      :locale="locale.locale.value"
      @change-locale="locale.setLocale"
      @dismiss="dismissSetup"
    />
    <section v-else-if="runner.connectionState.value === 'unavailable' && backend === 'api'" class="connection-error" role="alert">
      <span>{{ runner.error.value }}</span>
      <button type="button" @click="runner.load">{{ locale.t('connection.retry') }}</button>
    </section>
    <WorkbenchShell
      :terminal="terminal"
      v-if="!setupWelcome.isGuideOpen.value"
      :history-open="compactHistoryOpen"
      :inspector-open="compactInspectorOpen"
      :layout-mode="layout.mode.value"
      :activity="ide.activity.value"
      :sidebar-visible="ide.sidebarVisible.value"
      :panel-visible="ide.panelVisible.value"
      :panel-maximized="ide.panelMaximized.value"
      :files="workspace.files.value"
      :active-path="workspace.activePath.value"
      :tree="workspace.tree.value"
      :workspace-root="workspace.root.value"
      :workspace-kind="workspace.store.kind"
      :workspace-busy="workspace.status.value === 'loading'"
      :workspace-error="workspace.error.value"
      :creating-file="creatingFile"
      :reveal-request="revealRequest"
      :backend="backend"
      :local-available="localReady || local.runtimes.value.some((runtime) => runtime.available)"
      :isolated-available="isolatedReady || local.isolation.value.available"
      :local-runtimes="local.runtimes.value"
      :cursor="cursor"
      :status-text="statusText"
      :connection-state="connectionState"
      :workspace-label="workspace.root.value?.name"
      :history="runHistory.history.value"
      :runtimes="runner.runtimes.value"
      :runtime="selectedRuntime"
      :language="language"
      :source="source"
      :phase="executionPhase"
      :current-job="currentJob"
      :result="result"
      :error="requestError"
      :polling-stopped="pollingStopped"
      :active-output-tab="runner.activeOutputTab.value"
      :can-run="canRun"
      :can-resume="canResume"
      @select-activity="selectActivity"
      @toggle-sidebar="ide.toggleSidebar"
      @toggle-panel-maximize="ide.togglePanelMaximize"
      @close-panel="ide.togglePanel"
      @open-setup="setupWelcome.reopen"
      @select-file="selectFile"
      @close-file="closeFile"
      @reveal-file="revealInExplorer"
      @create-file="createFile"
      @update:creating-file="creatingFile = $event"
      @remove-file="removeFile"
      @open-folder="openFolder"
      @refresh-tree="refreshTree"
      @save-file="saveActive"
      @update:backend="updateBackend"
      @update:cursor="cursor = $event"
      @select-history="selectHistoryItem"
      @update:language="updateLanguage"
      @update:source="updateSource"
      @update:active-output-tab="setActiveOutputTab"
      @run="runActive"
      @stop="stopActive"
      @resume="resumeActive"
      @close-history="compactHistoryOpen = false"
      @close-inspector="compactInspectorOpen = false"
    />
  </div>
</template>
