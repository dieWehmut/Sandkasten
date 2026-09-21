<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue';
import AppHeader from './components/AppHeader.vue';
import CommandPalette from './components/CommandPalette.vue';
import ApiEndpointDialog from './components/ApiEndpointDialog.vue';
import SetupWelcome from './components/SetupWelcome.vue';
import WorkbenchShell from './components/WorkbenchShell.vue';
import SettingsView from './components/SettingsView.vue';
import { Settings } from '@lucide/vue';
import { useLocale } from './composables/useLocale';
import { useSetupWelcome } from './composables/useSetupWelcome';
import { useRunner, type OutputTab } from './composables/useRunner';
import { useLocalRunner } from './composables/useLocalRunner';
import { useRunHistory } from './composables/useRunHistory';
import { useWorkspace } from './composables/useWorkspace';
import { useEditorHistory } from './composables/useEditorHistory';
import { useWorkspaceSearch } from './composables/useWorkspaceSearch';
import { useCommandCenter, type PaletteCommand } from './composables/useCommandCenter';
import type { WorkspaceTreeNode } from './services/desktopBridge';
import { useIdeLayout } from './composables/useIdeLayout';
import { isExecutionBusy, type ExecutionBackend, type ExecutionPhase } from './composables/execution';
import { useTheme } from './composables/useTheme';
import { useColorScheme } from './composables/useColorScheme';
import { useAppearance } from './composables/useAppearance';
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
const search = useWorkspaceSearch();
const ide = useIdeLayout();
const theme = useTheme();
const colorScheme = useColorScheme();
const appearance = useAppearance(theme.theme, colorScheme.colorScheme);
const layout = useMediaLayout();
const locale = useLocale();
const setupWelcome = useSetupWelcome();
const compactHistoryOpen = ref(layout.isDesktop.value);
const compactInspectorOpen = ref(layout.isDesktop.value);
const runnerLoaded = ref(false);
const backend = ref<ExecutionBackend>('api');
const cursor = ref({ line: 1, column: 1 });
const creatingFile = ref(false);
const creatingFolder = ref(false);
// The token lets a repeated click on the same folder re-open it after the user
// folded it again; a bare path would not change and the watcher would stay put.
const revealRequest = ref<{ path: string; token: number }>();
let revealToken = 0;
const apiEndpointOpen = ref(false);
const settingsOpen = ref(false);
let settingsTrigger: HTMLElement | null = null;
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
function filePaths(nodes: readonly WorkspaceTreeNode[]): string[] {
  return nodes.flatMap((node) => node.type === 'file' ? [node.path] : filePaths(node.children ?? []));
}
const workspacePaths = computed(() => [...new Set([
  ...filePaths(workspace.tree.value), ...workspace.files.value.map((file) => file.path),
])]);
const editorHistory = useEditorHistory({
  activePath: workspace.activePath, paths: workspacePaths, openFile: workspace.openFile,
});
watch(() => workspace.root.value?.path, () => editorHistory.reset(), { flush: 'sync' });
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

function openSettings(): void {
  settingsTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  settingsOpen.value = true;
}

function closeSettings(): void {
  settingsOpen.value = false;
  void nextTick(() => {
    if (settingsTrigger?.isConnected) settingsTrigger.focus();
    else document.querySelector<HTMLElement>('[data-action="open-settings"]')?.focus();
  });
}

function showSettingsHistory(): void {
  settingsOpen.value = false;
  if (ideMode.value) ide.showActivity('runs');
  else { compactHistoryOpen.value = true; compactInspectorOpen.value = false; }
}

function showSettingsInspector(): void {
  settingsOpen.value = false;
  if (ideMode.value) ide.showActivity('context');
  else { compactInspectorOpen.value = true; compactHistoryOpen.value = false; }
}

function openSetupFromSettings(): void {
  settingsOpen.value = false;
  setupWelcome.reopen();
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
  // The reduced title row dropped the setup button, so the guide is reopened
  // from the command palette or the welcome screen. Focus the always-present
  // search control rather than leaving focus on a detached element.
  void nextTick(() => {
    document.querySelector<HTMLElement>('[data-action="quick-open"]')?.focus();
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

function createFile(payload: { name: string; language: string; folder: string }): void {
  void workspace.createFile(payload.name, payload.language, payload.folder)
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

function setCreatingFile(value: boolean): void {
  if (value) requestNewFile();
  else creatingFile.value = false;
}

// The new-folder form lives in the explorer, so the explorer stays the visible
// activity while the shell's header button opens it.
function setCreatingFolder(value: boolean): void {
  if (value) ide.showActivity('explorer');
  creatingFolder.value = value;
}

function createFolder(path: string): void {
  void workspace.createFolder(path).catch(() => undefined);
}

// Search reuses the same panel for every query, and a chosen match opens the
// file in the editor without leaving the results behind.
function runSearch(query: string): void {
  void search.run(query);
}

function selectSearchResult(path: string): void {
  void workspace.openFile(path);
}

async function openTerminal(mode: 'show' | 'new' | 'split' = 'show'): Promise<void> {
  if (!terminal) return;
  settingsOpen.value = false;
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

function syncTerminalFocus(event?: FocusEvent): void {
  const target = event?.type === 'focusout' ? event.relatedTarget : (event?.target ?? document.activeElement);
  terminal?.setFocused(Boolean(
    !settingsOpen.value && !setupWelcome.isGuideOpen.value && ide.panelVisible.value && terminal.shown.value
    && target instanceof Element && target.closest('.terminal-pane'),
  ));
}

const MENU_COMMANDS: Readonly<Record<string, () => void>> = {
  'settings.open': openSettings,
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
  'view.history': toggleHistory,
  'view.inspector': toggleInspector,
  'locale.en': () => locale.setLocale('en'),
  'locale.zh-CN': () => locale.setLocale('zh-CN'),
  'navigation.back': () => { void editorHistory.back(); },
  'navigation.forward': () => { void editorHistory.forward(); },
};

const commandPaletteError = ref('');
const paletteCommands = computed<PaletteCommand[]>(() => {
  const modifier = bridge?.platform === 'darwin' ? '⌘' : 'Ctrl+';
  const command = (id: string, key: MessageKey, accelerator?: string, enabled = true): PaletteCommand => ({
    id, label: locale.t(key), accelerator, enabled: enabled && Boolean(MENU_COMMANDS[id]), execute: MENU_COMMANDS[id],
  });
  return [
    command('settings.open', 'palette.settings', `${modifier},`),
    command('workspace.open', 'ide.explorer.openFolder', `${modifier}O`, workspace.isDesktop.value),
    command('file.new', 'ide.explorer.newFile', `${modifier}N`),
    command('file.save', 'ide.workspace.save', `${modifier}S`, Boolean(activeFile.value)),
    command('file.closeTab', 'palette.closeEditor', `${modifier}W`, Boolean(activeFile.value)),
    command('run.start', 'palette.run', 'F5', canRun.value),
    command('run.stop', 'palette.stop', 'Shift+F5', isExecutionBusy(executionPhase.value)),
    command('navigation.back', 'navigation.back', 'Alt+Left', editorHistory.canBack.value),
    command('navigation.forward', 'navigation.forward', 'Alt+Right', editorHistory.canForward.value),
    command('view.toggleSidebar', 'palette.sidebar', `${modifier}B`, ideMode.value),
    command('view.togglePanel', 'palette.panel', `${modifier}J`, ideMode.value),
    command('view.history', !ideMode.value && historyOpen.value ? 'header.history.hide' : 'header.history.show'),
    command('view.inspector', !ideMode.value && inspectorOpen.value ? 'header.inspector.hide' : 'header.inspector.show'),
    command('terminal.toggle', 'palette.terminal', 'Ctrl+`', Boolean(terminal)),
    command('terminal.new', 'terminal.new', `${modifier}Shift+\``, Boolean(terminal?.profiles.value.length) && !terminal?.pending.value),
    command('terminal.split', 'terminal.split', undefined, Boolean(terminal?.sessions.value.length) && !terminal?.pending.value),
    command('view.toggleSetup', 'header.setup'),
    command('apiEndpoint.open', 'apiEndpoint.open'),
    command('theme.toggle', theme.theme.value === 'light' ? 'header.theme.useDark' : 'header.theme.useLight'),
    command('locale.en', 'locale.switchToEnglish', undefined, locale.locale.value !== 'en'),
    command('locale.zh-CN', 'locale.switchToChinese', undefined, locale.locale.value !== 'zh-CN'),
    command('help.github', 'header.github'),
  ];
});
const commandCenter = useCommandCenter({
  paths: workspacePaths, recentPaths: editorHistory.recentPaths, commands: paletteCommands,
  t: locale.t, platform: bridge?.platform,
});

function openPalette(mode: 'files' | 'commands' = 'files'): void {
  commandPaletteError.value = '';
  commandCenter.openPalette(mode);
}

async function selectPaletteItem(id: string): Promise<void> {
  const item = commandCenter.items.value.find((candidate) => candidate.id === id);
  if (!item) return;
  if (item.kind === 'mode') { openPalette('commands'); return; }
  const command = item.kind === 'command' ? commandCenter.availableCommands.value.find((candidate) => candidate.id === id) : undefined;
  commandCenter.close();
  // Restore the previous focus before executing an action that opens another view.
  await nextTick();
  try {
    if (item.kind === 'file') await workspace.openFile(id);
    else await command?.execute();
  } catch {
    commandCenter.openPalette(item.kind === 'command' ? 'commands' : 'files');
    commandPaletteError.value = locale.t('palette.failed');
  }
}

function onKeydown(event: KeyboardEvent): void {
  // The settings screen owns Escape while it is up, before any global handler
  // gets a chance to act on the same key.
  if (settingsOpen.value && event.key === 'Escape' && !apiEndpointOpen.value) {
    event.preventDefault();
    closeSettings();
    return;
  }
  if (event.defaultPrevented) return;
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && !event.altKey && (key === 'p' || (key === 'e' && !event.shiftKey))) {
    if (setupWelcome.isGuideOpen.value) return;
    event.preventDefault();
    openPalette(event.shiftKey ? 'commands' : 'files');
    return;
  }
  if (commandCenter.open.value) return;
  if (event.key === 'F5' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    if (event.shiftKey) stopActive();
    else void runActive();
    return;
  }
  if (event.altKey && !event.ctrlKey && !event.metaKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault();
    void (event.key === 'ArrowLeft' ? editorHistory.back() : editorHistory.forward());
    return;
  }
  if (terminal && isTerminalShortcut(event)) {
    event.preventDefault();
    if (event.shiftKey) void openTerminal('new');
    else toggleTerminal();
    return;
  }
  if (event.target instanceof Element && event.target.closest('.terminal-panel')) return;
  if (!(event.ctrlKey || event.metaKey)) return;
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
watch([theme.theme, colorScheme.colorScheme, appearance.colors], () => { void nextTick(() => terminal?.syncTheme()); });
if (terminal) watch([terminal.shown, ide.panelVisible, setupWelcome.isGuideOpen, settingsOpen], () => syncTerminalFocus(), { flush: 'post' });

onMounted(() => {
  void terminal?.loadProfiles();
  if (!setupWelcome.isGuideOpen.value) loadRunnerOnce();
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('focusin', syncTerminalFocus);
  window.addEventListener('focusout', syncTerminalFocus);
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
  window.removeEventListener('focusin', syncTerminalFocus);
  window.removeEventListener('focusout', syncTerminalFocus);
  theme.dispose();
  appearance.dispose();
  layout.dispose();
});
</script>

<template>
  <div
    class="workbench-app"
    :class="{ 'workbench-app--ide': layout.isDesktop.value && !setupWelcome.isGuideOpen.value, 'workbench-app--integrated': Boolean(bridge?.windowChrome?.integrated) }"
    data-testid="app-shell"
  >
    <AppHeader
      v-if="!setupWelcome.isGuideOpen.value"
      :theme="theme.theme.value"
      :locale="locale.locale.value"
      :t="locale.t"
      :window-title="documentTitle"
      :chrome="bridge?.windowChrome"
      :platform="bridge?.platform"
      :can-back="editorHistory.canBack.value"
      :can-forward="editorHistory.canForward.value"
      @navigate-back="editorHistory.back"
      @navigate-forward="editorHistory.forward"
      :palette-open="commandCenter.open.value"
      @quick-open="openPalette()"
    />
    <CommandPalette
      :open="commandCenter.open.value"
      :query="commandCenter.query.value"
      :items="commandCenter.items.value"
      :error="commandPaletteError"
      :t="locale.t"
      @update:query="commandCenter.query.value = $event"
      @select="selectPaletteItem"
      @close="commandCenter.close"
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
    <WorkbenchShell
      :terminal="terminal"
      v-if="!setupWelcome.isGuideOpen.value"
      v-show="!settingsOpen"
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
      :platform="bridge?.platform"
      :workspace-busy="workspace.status.value === 'loading'"
      :workspace-error="workspace.error.value"
      :creating-file="creatingFile"
      :creating-folder="creatingFolder"
      :search="search"
      :reveal-request="revealRequest"
      :backend="backend"
      :local-available="localReady || local.runtimes.value.some((runtime) => runtime.available)"
      :isolated-available="isolatedReady || local.isolation.value.available"
      :local-runtimes="local.runtimes.value"
      :cursor="cursor"
      :status-text="statusText"
      :connection-state="connectionState"
      :icon-theme="theme.theme.value"
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
      @open-settings="openSettings"
      @select-file="selectFile"
      @close-file="closeFile"
      @reveal-file="revealInExplorer"
      @create-file="createFile"
      @update:creating-file="setCreatingFile"
      @update:creating-folder="setCreatingFolder"
      @create-folder="createFolder"
      @search-files="runSearch"
      @select-search-result="selectSearchResult"
      @update:search-query="search.query.value = $event"
      @update:search-case-sensitive="search.caseSensitive.value = $event"
      @clear-search="search.clear()"
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
    <button v-if="!layout.isDesktop.value && !setupWelcome.isGuideOpen.value && !settingsOpen" type="button" class="compact-settings-entry" data-action="open-settings" @click="openSettings"><Settings :size="17" aria-hidden="true" />{{ locale.t('settings.title') }}</button>
    <SettingsView
      v-if="settingsOpen && !setupWelcome.isGuideOpen.value"
      :preference="theme.preference.value"
      :theme="theme.theme.value"
      :colors="appearance.colors.value"
      :color-scheme="colorScheme.colorScheme.value"
      :locale="locale.locale.value"
      :t="locale.t"
      :connection-state="runner.connectionState.value"
      :api-endpoint="configuredApiBaseUrl"
      @back="closeSettings"
      @change-theme="theme.setTheme"
      @change-color="appearance.setColor"
      @reset-colors="appearance.resetColors"
      @change-color-scheme="colorScheme.setColorScheme"
      @change-locale="locale.setLocale"
      @open-api-endpoint="openApiEndpoint"
      @open-setup="openSetupFromSettings"
      @show-history="showSettingsHistory"
      @show-inspector="showSettingsInspector"
      @open-github="openGithub"
    />
  </div>
</template>
