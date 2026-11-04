<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { DeepReadonly } from 'vue';
import { FilePlus, FolderPlus, ListCollapse, PanelLeftClose, RefreshCw, Trash2 } from '@lucide/vue';
import type { OutputTab } from '../composables/useRunner';
import type { ConnectionState } from '../composables/useRunner';
import type { ExecutionBackend, ExecutionPhase } from '../composables/execution';
import type { IdeActivity } from '../composables/useIdeLayout';
import type { WorkspaceFile } from '../composables/useWorkspace';
import type { RunHistoryItem } from '../composables/useRunHistory';
import type { JobResponse, Runtime } from '../services/sandkastenApi';
import type { LocalRuntimeInfo, WorkspaceRoot, WorkspaceTreeNode } from '../services/desktopBridge';
import type { LayoutMode } from '../composables/useMediaLayout';
import type { TerminalController } from '../composables/useTerminal';
import type { WorkspaceSearchController } from '../composables/useWorkspaceSearch';
import type { RemoteHostsController } from '../composables/useRemoteHosts';
import type { SourceControlController } from '../composables/useSourceControl';
import type { IconTheme } from '../editor/fileIcon';
import type { EditorSettings } from '../state/editorSettings';
import {
  PANEL_DEFAULT_HEIGHT,
  PANEL_MAX_HEIGHT,
  PANEL_MIN_HEIGHT,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from '../state/editorSettings';
import type { Theme } from '../composables/useTheme';
import EdgeSheet from './EdgeSheet.vue';
import EditorWelcome from './EditorWelcome.vue';
import InspectorPanel from './InspectorPanel.vue';
import JobTimeline from './JobTimeline.vue';
import OutputTabs from './OutputTabs.vue';
import RunHistory from './RunHistory.vue';
import SourceEditor from './SourceEditor.vue';
import SourceWorkbench from './SourceWorkbench.vue';
import EditorTabs from './ide/EditorTabs.vue';
import IdeActivityBar from './ide/IdeActivityBar.vue';
import IdeBreadcrumbs from './ide/IdeBreadcrumbs.vue';
import IdeEditorToolbar from './ide/IdeEditorToolbar.vue';
import IdePanelActions from './ide/IdePanelActions.vue';
import IdePaneHeader from './ide/IdePaneHeader.vue';
import IdeSash from './ide/IdeSash.vue';
import IdeStatusBar from './ide/IdeStatusBar.vue';
import WorkspaceExplorer from './ide/WorkspaceExplorer.vue';
import WorkspaceSearch from './ide/WorkspaceSearch.vue';
import RemoteExplorer from './ide/RemoteExplorer.vue';
import SourceControlView from './ide/SourceControlView.vue';
import { useTranslation } from '../i18n/useTranslation';

const props = withDefaults(defineProps<{
  historyOpen: boolean;
  inspectorOpen: boolean;
  /** The settings page occupies the editor group, as it does in the reference. */
  settingsOpen?: boolean;
  layoutMode?: LayoutMode;
  history: readonly DeepReadonly<RunHistoryItem>[];
  runtimes: Runtime[];
  runtime?: Runtime;
  language: string;
  source: string;
  editorSettings?: Partial<EditorSettings>;
  phase: ExecutionPhase;
  currentJob?: JobResponse;
  result?: JobResponse;
  error?: string;
  pollingStopped?: boolean;
  activeOutputTab: OutputTab;
  canRun: boolean;
  canResume: boolean;
  activity?: IdeActivity;
  sidebarVisible?: boolean;
  runsExpanded?: boolean;
  panelVisible?: boolean;
  panelMaximized?: boolean;
  /**
   * Zen mode. The shell paints the chrome it is told to paint rather than reading the
   * preference itself, so the same controller drives the palette command, the Escape
   * handler and the layout without any of them owning the state.
   */
  zenActive?: boolean;
  zenShowActivityBar?: boolean;
  zenShowStatusBar?: boolean;
  zenShowTabs?: boolean;
  zenSingleTab?: boolean;
  zenHideLineNumbers?: boolean;
  /** The centred column's width in pixels, or null when Zen mode is not centring. */
  zenCenteredWidth?: number | null;
  zenCenteredMargin?: number;
  /** Pane sizes in pixels, owned by `useIdeLayout` so both sashes agree. */
  sidebarWidth?: number;
  panelHeight?: number;
  sidebarMinWidth?: number;
  sidebarMaxWidth?: number;
  panelMinHeight?: number;
  panelMaxHeight?: number;
  files?: readonly WorkspaceFile[];
  activePath?: string;
  tree?: WorkspaceTreeNode[];
  workspaceRoot?: WorkspaceRoot;
  workspaceKind?: 'memory' | 'desktop';
  platform?: string;
  workspaceBusy?: boolean;
  workspaceError?: string;
  creatingFile?: boolean;
  creatingFolder?: boolean;
  collapseRequest?: { token: number };
  revealRequest?: { path: string; token: number };
  backend?: ExecutionBackend;
  localAvailable?: boolean;
  isolatedAvailable?: boolean;
  localRuntimes?: LocalRuntimeInfo[];
  cursor?: { line: number; column: number };
  statusText?: string;
  connectionState?: ConnectionState;
  workspaceLabel?: string;
  recentFiles?: readonly string[];
  apiHost?: string;
  terminal?: TerminalController;
  search?: WorkspaceSearchController;
  remote?: RemoteHostsController;
  sourceControl?: SourceControlController;
  iconTheme?: IconTheme;
  /** The active theme, so the activity bar's footer can offer the toggle. */
  theme?: Theme;
}>(), {
  layoutMode: 'desktop',
  activity: 'explorer',
  sidebarVisible: true,
  runsExpanded: true,
  panelVisible: true,
  panelMaximized: false,
  sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
  panelHeight: PANEL_DEFAULT_HEIGHT,
  sidebarMinWidth: SIDEBAR_MIN_WIDTH,
  sidebarMaxWidth: SIDEBAR_MAX_WIDTH,
  panelMinHeight: PANEL_MIN_HEIGHT,
  panelMaxHeight: PANEL_MAX_HEIGHT,
  files: () => [],
  activePath: '',
  tree: () => [],
  workspaceKind: 'memory',
  workspaceBusy: false,
  creatingFile: false,
  creatingFolder: false,
  collapseRequest: () => ({ token: 0 }),
  backend: 'api',
  localAvailable: false,
  isolatedAvailable: false,
  localRuntimes: () => [],
  cursor: () => ({ line: 1, column: 1 }),
  statusText: 'Ready',
  connectionState: 'connecting',
  recentFiles: () => [],
  apiHost: '',
  iconTheme: 'dark',
  theme: 'dark',
  zenActive: false,
  // Default to the ordinary shell: every part painted, nothing centred. Zen mode
  // turns parts off, so an off-by-default here means a shell that never hides
  // anything unless the controller says so.
  zenShowActivityBar: true,
  zenShowStatusBar: true,
  zenShowTabs: true,
  zenSingleTab: false,
  zenHideLineNumbers: false,
  zenCenteredWidth: null,
  zenCenteredMargin: 0,
});

const emit = defineEmits<{
  selectHistory: [item: DeepReadonly<RunHistoryItem>];
  'update:language': [language: string];
  'update:source': [source: string];
  'update:activeOutputTab': [tab: OutputTab];
  'update:backend': [backend: ExecutionBackend];
  'update:cursor': [position: { line: number; column: number }];
  run: [];
  stop: [];
  resume: [];
  closeHistory: [];
  closeInspector: [];
  selectActivity: [activity: IdeActivity];
  toggleSidebar: [];
  toggleRunsSection: [];
  clearHistory: [];
  togglePanelMaximize: [];
  closePanel: [];
  resizeSidebar: [width: number];
  resizePanel: [height: number];
  resetPaneSizes: [];
  // The editor group's measured width. The centred column is a fraction of it, so the
  // owner of the Zen controller needs the real number rather than a guess; the shell
  // is the only place that can measure it, and it reports on every resize.
  measureEditorWidth: [width: number];
  openSetup: [];
  openSettings: [];
  toggleTheme: [];
  openPalette: [];
  showPanel: [];
  toggleTerminal: [];
  selectFile: [path: string];
  revealFile: [path: string];
  selectSearchResult: [path: string];
  'update:searchQuery': [value: string];
  'update:searchCaseSensitive': [value: boolean];
  clearSearch: [];
  openRemote: [payload: { host: string; directory: string }];
  rememberRemoteDirectory: [payload: { host: string; directory: string }];
  forgetRemoteDirectory: [payload: { host: string; directory: string }];
  refreshSourceControl: [];
  'update:sourceControlMessage': [value: string];
  stageSourceControl: [paths: string[]];
  commitSourceControl: [];
  closeFile: [path: string];
  closeFiles: [paths: string[]];
  copyFilePath: [path: string];
  revealFile: [path: string];
  moveFile: [payload: { from: string; toIndex: number }];
  createFile: [payload: { name: string; language: string; folder: string }];
  createFolder: [path: string];
  searchFiles: [query: string];
  'update:creatingFile': [value: boolean];
  'update:creatingFolder': [value: boolean];
  removeFile: [path: string];
  openFolder: [];
  refreshTree: [];
  collapseFolders: [];
  saveFile: [];
}>();
const t = useTranslation();

// The explorer owns the tree, so the sidebar's collapse action asks the app for a
// new request token and the explorer folds every open directory when it changes.
const isIde = computed(() => props.layoutMode === 'desktop');
const dirtyPaths = computed(() => props.files.filter((file) => file.dirty).map((file) => file.path));
const sidebarTitle = computed(() => {
  if (props.activity === 'runs') return t('history.title');
  if (props.activity === 'context') return t('inspector.title');
  if (props.activity === 'remote') return t('ide.activity.remote');
  if (props.activity === 'source-control') return t('ide.activity.sourceControl');
  return props.workspaceRoot?.name || t('ide.explorer.scratch');
});
// `zenMode.hideLineNumbers` is a Zen-mode switch, not a change to the user's own
// setting, so it is folded in for as long as the mode is on and the stored preference
// stays untouched underneath. The reference behaves the same way: leaving Zen mode
// restores whatever `editor.lineNumbers` was, because the switch never wrote to it.
const effectiveEditorSettings = computed<Partial<EditorSettings>>(() => (
  props.zenHideLineNumbers
    ? { ...props.editorSettings, lineNumbers: false }
    : props.editorSettings ?? {}
));
// `zenMode.showTabs: "single"` narrows the strip to the one file on screen instead
// of hiding it, so the reader keeps a title and a close button without the lane.
const singleVisibleFile = computed(() => {
  if (!props.zenSingleTab) return props.files;
  const current = props.files.find((file) => file.path === props.activePath);
  return current ? [current] : props.files;
});
const styles = computed(() => (isIde.value
  ? ['layout-ide', {
    'without-sidebar': !props.sidebarVisible,
    'without-panel': !props.panelVisible,
    'panel-maximized': props.panelMaximized,
    // Zen mode is expressed as grid changes rather than by unmounting the panes:
    // the activity bar leaves its column and the status bar leaves its row, so the
    // remaining panes take the space without a remount of the editor.
    'zen-active': props.zenActive,
    'zen-without-activity-bar': props.zenActive && !props.zenShowActivityBar,
    'zen-without-status-bar': props.zenActive && !props.zenShowStatusBar,
    'zen-centered': props.zenCenteredWidth !== null,
  }]
  : [`layout-${props.layoutMode}`, {
    'without-history': !props.historyOpen,
    'without-inspector': !props.inspectorOpen,
  }]));
// The grid column and the panel's flex basis both read these, so one resize
// moves the pane and the sash together.
const paneStyle = computed(() => {
  const base: Record<string, string> = isIde.value
    ? {
      '--ide-sidebar-width': `${props.sidebarWidth}px`,
      '--ide-panel-height': `${props.panelHeight}px`,
    }
    : {};
  // The centred column is a real width, so it is handed to CSS as a length the grid
  // can consume directly. Zero margin means no centring, and the properties are then
  // omitted rather than set to 0 so the ordinary shell keeps its single-column grid.
  if (props.zenCenteredWidth !== null && props.zenCenteredMargin > 0) {
    base['--zen-column-width'] = `${props.zenCenteredWidth}px`;
    base['--zen-column-margin'] = `${props.zenCenteredMargin}px`;
  }
  return base;
});

// The editor group's width, reported upward so the Zen controller can size the
// centred column. A ResizeObserver rather than a window listener, because the group
// also shrinks when a sidebar or the panel is toggled, and a window-only measurement
// would keep the column sized for a window that is not what the pane actually has.
const editorPane = ref<HTMLElement | null>(null);
let observer: ResizeObserver | null = null;

const reportWidth = (): void => {
  const width = editorPane.value?.clientWidth ?? 0;
  if (width > 0) emit('measureEditorWidth', width);
};

onMounted(() => {
  reportWidth();
  if (editorPane.value && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(reportWidth);
    observer.observe(editorPane.value);
  }
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});
</script>

<template>
  <div class="workbench-shell" :class="styles" :style="paneStyle" data-testid="workbench-shell">
    <template v-if="isIde">
      <IdeActivityBar
        v-if="zenShowActivityBar"
        :active="activity"
        :sidebar-visible="sidebarVisible"
        :badges="{ explorer: dirtyPaths.length }"
        :theme="theme"
        @select="emit('selectActivity', $event)"
        @open-settings="emit('openSettings')"
        @toggle-theme="emit('toggleTheme')"
      />
      <aside v-if="sidebarVisible" class="ide-sidebar" :aria-label="t('ide.sidebar.label')">
        <header class="ide-sidebar__header">
          <span class="ide-sidebar__title" :title="workspaceRoot?.path ?? sidebarTitle">{{ sidebarTitle }}</span>
          <span class="ide-sidebar__actions">
            <template v-if="activity === 'explorer'">
              <button type="button" data-action="ide-new-file" :aria-label="t('ide.explorer.newFile')" :title="t('ide.explorer.newFile')" @click="emit('update:creatingFile', true)">
                <FilePlus :size="15" aria-hidden="true" />
              </button>
              <button type="button" data-action="ide-new-folder" :aria-label="t('ide.explorer.newFolder')" :title="t('ide.explorer.newFolder')" @click="emit('update:creatingFolder', true)">
                <FolderPlus :size="15" aria-hidden="true" />
              </button>
              <button type="button" data-action="ide-refresh-tree" :aria-label="t('ide.explorer.refresh')" :title="t('ide.explorer.refresh')" :disabled="workspaceBusy" @click="emit('refreshTree')">
                <RefreshCw :size="15" aria-hidden="true" />
              </button>
<button
                type="button"
                class="ide-sidebar__collapse-folders"
                data-action="ide-collapse-folders"
                :aria-label="t('ide.explorer.collapseFolders')"
                :title="t('ide.explorer.collapseFolders')"
                @click="emit('collapseFolders')"
              >
                <ListCollapse :size="15" aria-hidden="true" />
              </button>
            </template>
            <button
              type="button"
              class="ide-sidebar__collapse"
              data-action="ide-collapse-sidebar"
              :aria-label="t('ide.sidebar.collapse')"
              :title="t('ide.sidebar.collapse')"
              @click="emit('toggleSidebar')"
            >
              <PanelLeftClose :size="15" aria-hidden="true" />
            </button>
          </span>
        </header>
        <template v-if="activity === 'explorer'">
          <WorkspaceExplorer
            :tree="tree"
            :root="workspaceRoot"
            :kind="workspaceKind"
            :active-path="activePath"
            :dirty-paths="dirtyPaths"
            :busy="workspaceBusy"
            :error="workspaceError"
            :runtimes="runtimes"
            :creating="creatingFile"
            :creating-folder="creatingFolder"
            :reveal-request="revealRequest"
            :collapse-request="collapseRequest"
            :icon-theme="iconTheme"
            hide-heading
            @update:creating="emit('update:creatingFile', $event)"
            @update:creating-folder="emit('update:creatingFolder', $event)"
            @select="emit('selectFile', $event)"
            @open-folder="emit('openFolder')"
            @refresh="emit('refreshTree')"
            @create="emit('createFile', $event)"
            @create-folder="emit('createFolder', $event)"
            @remove="emit('removeFile', $event)"
          />
          <section class="ide-sidebar__section" :aria-label="t('history.title')">
            <IdePaneHeader :label="t('history.title')" :expanded="runsExpanded" @toggle="emit('toggleRunsSection')">
              <template #actions>
                <button
                  v-if="history.length"
                  type="button"
                  class="ide-pane-header__action"
                  data-action="ide-clear-history"
                  :aria-label="t('history.clear')"
                  :title="t('history.clear')"
                  @click="emit('clearHistory')"
                >
                  <Trash2 :size="14" aria-hidden="true" />
                </button>
              </template>
            </IdePaneHeader>
            <RunHistory v-if="runsExpanded" :items="history" :selected-job-id="result?.jobId" hide-heading @select="emit('selectHistory', $event)" />
          </section>
        </template>
        <WorkspaceSearch
          v-else-if="activity === 'search'"
          :state="search?.state.value ?? 'idle'"
          :query="search?.query.value ?? ''"
          :files="search?.results.value ?? []"
          :case-sensitive="search?.caseSensitive.value ?? false"
          :file-count="search?.fileCount.value ?? 0"
          :match-count="search?.matchCount.value ?? 0"
          :truncated="search?.truncated.value ?? false"
          :error="search?.error.value"
          :desktop="workspaceKind === 'desktop'"
          :icon-theme="iconTheme"
          @update:query="emit('update:searchQuery', $event)"
          @update:case-sensitive="emit('update:searchCaseSensitive', $event)"
          @search="emit('searchFiles', $event)"
          @select="emit('selectSearchResult', $event)"
          @clear="emit('clearSearch')"
        />
        <RemoteExplorer
          v-else-if="activity === 'remote'"
          :state="remote?.state.value ?? 'idle'"
          :available="remote?.available.value ?? true"
          :hosts="remote?.hosts.value ?? []"
          :config-path="remote?.configPath.value ?? ''"
          :error="remote?.error.value"
          :desktop="workspaceKind === 'desktop'"
          @open="emit('openRemote', $event)"
          @remember="emit('rememberRemoteDirectory', $event)"
          @forget="emit('forgetRemoteDirectory', $event)"
        />
        <SourceControlView
          v-else-if="activity === 'source-control'"
          :state="sourceControl?.state.value ?? 'idle'"
          :branch="sourceControl?.branch.value ?? ''"
          :changes="sourceControl?.changes.value ?? []"
          :history="sourceControl?.history.value ?? []"
          :staged-count="sourceControl?.stagedCount.value ?? 0"
          :unstaged-changes="sourceControl?.unstagedChanges.value ?? []"
          :staged-changes="sourceControl?.stagedChanges.value ?? []"
          :message="sourceControl?.message.value ?? ''"
          :error="sourceControl?.error.value"
          :desktop="workspaceKind === 'desktop'"
          :busy="sourceControl?.busy.value ?? false"
          :can-commit="sourceControl?.canCommit.value ?? false"
          @refresh="emit('refreshSourceControl')"
          @update:message="emit('update:sourceControlMessage', $event)"
          @stage="emit('stageSourceControl', $event)"
          @commit="emit('commitSourceControl')"
        />
        <RunHistory v-else-if="activity === 'runs'" :items="history" :selected-job-id="result?.jobId" hide-heading @select="emit('selectHistory', $event)" />
        <InspectorPanel v-else :runtime="runtime" :job="result" :error="error" hide-heading />
      </aside>
      <!-- The sash overlays the sidebar's trailing edge instead of taking a grid
           column, which is how the reference's split view draws it: the panes
           keep their measured widths and the boundary carries the splitter. -->
      <IdeSash
        v-if="sidebarVisible"
        class="ide-sash--sidebar"
        orientation="vertical"
        :value="sidebarWidth"
        :min="sidebarMinWidth"
        :max="sidebarMaxWidth"
        :label="t('ide.sidebar.resize')"
        @resize="emit('resizeSidebar', $event)"
        @reset="emit('resetPaneSizes')"
      />
      <section class="ide-main" :aria-label="t('workbench.source')">
        <!-- The tab strip, breadcrumbs and run toolbar all describe the file in the
             editor. While the settings page occupies the editor group they would
             name a file that is not on screen, so they step aside. -->
        <EditorTabs
          v-if="files.length && !settingsOpen && zenShowTabs"
          :files="singleVisibleFile"
          :active-path="activePath"
          :icon-theme="iconTheme"
          @select="emit('selectFile', $event)"
          @close="emit('closeFile', $event)"
          @close-many="emit('closeFiles', $event)"
          @copy-path="emit('copyFilePath', $event)"
          @reveal="emit('revealFile', $event)"
          @move="emit('moveFile', $event)"
        />
        <IdeBreadcrumbs
          v-if="files.length && !settingsOpen"
          :file-path="activePath"
          :root-path="workspaceRoot?.path"
          :tree="tree"
          :icon-theme="iconTheme"
          @reveal="emit('revealFile', $event)"
          @select="emit('selectFile', $event)"
        />
        <IdeEditorToolbar
          v-if="files.length && !settingsOpen"
          :runtimes="runtimes"
          :language="language"
          :backend="backend"
          :local-available="localAvailable"
          :isolated-available="isolatedAvailable"
          :phase="phase"
          :can-run="canRun"
          :can-resume="canResume"
          :dirty="dirtyPaths.includes(activePath)"
          @update:language="emit('update:language', $event)"
          @update:backend="emit('update:backend', $event)"
          @save="emit('saveFile')"
          @run="emit('run')"
          @stop="emit('stop')"
          @resume="emit('resume')"
        />
        <div class="ide-body">
          <section ref="editorPane" class="ide-editor" :class="{ 'ide-editor--welcome': !files.length, 'ide-editor--settings': settingsOpen }" :aria-label="t('workbench.editor')">
            <!-- The Settings page opens *in* the editor group, exactly as the
                 reference's does, so the activity bar and side bar stay in place
                 beside it. The editor itself stays mounted underneath (hidden, not
                 unmounted) so its CodeMirror view, undo history and scroll position
                 survive the trip through settings — the reference's editor tab keeps
                 its state too. -->
            <div v-show="!settingsOpen" class="ide-editor__content">
            <SourceEditor
              v-if="files.length"
              :model-value="source"
              :language="language"
              :label="t('workbench.programSource')"
              :options="effectiveEditorSettings"
              minimap
              @update:model-value="emit('update:source', $event)"
              @update:cursor="emit('update:cursor', $event)"
            />
            <EditorWelcome
              v-else
              :desktop="workspaceKind === 'desktop'"
              :platform="platform"
              :recent="recentFiles"
              @new-file="emit('update:creatingFile', true)"
              @open-folder="emit('openFolder')"
              @open-setup="emit('openSetup')"
              @open-settings="emit('openSettings')"
              @open-palette="emit('openPalette')"
              @select-file="emit('selectFile', $event)"
            />
            </div>
            <slot v-if="settingsOpen" name="editor" />
          </section>
          <JobTimeline :phase="phase" :current-job="currentJob" :error="error" :polling-stopped="pollingStopped" />
          <!-- The panel's splitter is a sibling of the panel rather than a child,
               because the panel is its own scrollport and an absolutely
               positioned handle inside it would scroll away with the output.
               The dock owns the panel's height so the sash can ride its top
               edge without changing the measured panel geometry. -->
          <div v-if="panelVisible" class="ide-panel-dock" :class="{ 'ide-panel-dock--maximized': panelMaximized }">
            <IdeSash
              v-if="!panelMaximized"
              class="ide-sash--panel"
              orientation="horizontal"
              :value="panelHeight"
              :min="panelMinHeight"
              :max="panelMaxHeight"
              :label="t('ide.panel.resize')"
              @resize="emit('resizePanel', $event)"
              @reset="emit('resetPaneSizes')"
            />
            <section class="ide-panel" :aria-label="t('workbench.resultOutput')">
              <OutputTabs
                :source="source"
                :language="language"
                :terminal="terminal"
                :result="result"
                :error="error"
                :model-value="activeOutputTab"
                @update:model-value="emit('update:activeOutputTab', $event)"
              >
                <template #actions>
                  <IdePanelActions
                    :maximized="panelMaximized"
                    @toggle-maximize="emit('togglePanelMaximize')"
                    @close="emit('closePanel')"
                  />
                </template>
              </OutputTabs>
            </section>
          </div>
        </div>
      </section>
      <!-- The strip is a sibling of the panes, not part of the editor card, so it
           spans the whole shell the way the VS Code status bar does. -->
      <IdeStatusBar
        v-if="zenShowStatusBar"
        :backend="backend"
        :language="language"
        :file-path="activePath"
        :dirty="dirtyPaths.includes(activePath)"
        :phase="phase"
        :status-text="statusText"
        :cursor="cursor"
        :connection-state="connectionState"
        :workspace-label="workspaceLabel"
        :duration-ms="result?.durationMs"
        :exit-code="result?.exitCode"
        :source="source"
        :job="result"
        :error="error"
        :api-host="apiHost"
        :history-count="history.length"
        :terminal-available="Boolean(terminal)"
        :icon-theme="iconTheme"
        @open-settings="emit('openSettings')"
        @open-setup="emit('openSetup')"
        @show-panel="emit('showPanel')"
        @toggle-terminal="emit('toggleTerminal')"
        @select-runs="emit('selectActivity', 'runs')"
        @save-file="emit('saveFile')"
      />
    </template>

    <template v-else>
      <RunHistory v-if="layoutMode === 'desktop' && historyOpen" :items="history" :selected-job-id="result?.jobId" @select="emit('selectHistory', $event)" />
      <SourceWorkbench
        :editor-settings="editorSettings"
        :terminal="terminal"
        :panel-visible="panelVisible"
        :runtimes="runtimes"
        :language="language"
        :source="source"
        :phase="phase"
        :current-job="currentJob"
        :result="result"
        :error="error"
        :polling-stopped="pollingStopped"
        :active-output-tab="activeOutputTab"
        :can-run="canRun"
        :can-resume="canResume"
        :disabled="!files.length"
        @update:language="emit('update:language', $event)"
        @update:source="emit('update:source', $event)"
        @update:active-output-tab="emit('update:activeOutputTab', $event)"
        @run="emit('run')"
        @stop="emit('stop')"
        @resume="emit('resume')"
      />
      <InspectorPanel v-if="layoutMode === 'desktop' && inspectorOpen" :runtime="runtime" :job="result" :error="error" />
      <EdgeSheet v-if="layoutMode !== 'desktop'" :open="historyOpen" side="left" :title="t('history.title')" @close="emit('closeHistory')">
        <RunHistory :items="history" :selected-job-id="result?.jobId" @select="emit('selectHistory', $event)" />
      </EdgeSheet>
      <EdgeSheet v-if="layoutMode !== 'desktop'" :open="inspectorOpen" side="right" :title="t('inspector.title')" @close="emit('closeInspector')">
        <InspectorPanel :runtime="runtime" :job="result" :error="error" />
      </EdgeSheet>
      <!-- The compact layouts have no editor group to open the page inside, so the
           settings page covers the whole shell there, as it always has. -->
      <slot v-if="settingsOpen" name="editor" />
    </template>
  </div>
</template>
