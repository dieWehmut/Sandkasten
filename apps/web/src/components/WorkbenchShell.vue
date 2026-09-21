<script setup lang="ts">
import { computed, ref } from 'vue';
import type { DeepReadonly } from 'vue';
import { FilePlus, FolderPlus, ListCollapse, PanelLeftClose, RefreshCw } from '@lucide/vue';
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
import IdeStatusBar from './ide/IdeStatusBar.vue';
import WorkspaceExplorer from './ide/WorkspaceExplorer.vue';
import WorkspaceSearch from './ide/WorkspaceSearch.vue';
import RemoteExplorer from './ide/RemoteExplorer.vue';
import SourceControlView from './ide/SourceControlView.vue';
import { useTranslation } from '../i18n/useTranslation';

const props = withDefaults(defineProps<{
  historyOpen: boolean;
  inspectorOpen: boolean;
  layoutMode?: LayoutMode;
  history: readonly DeepReadonly<RunHistoryItem>[];
  runtimes: Runtime[];
  runtime?: Runtime;
  language: string;
  source: string;
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
  panelVisible?: boolean;
  panelMaximized?: boolean;
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
  terminal?: TerminalController;
  search?: WorkspaceSearchController;
  remote?: RemoteHostsController;
  sourceControl?: SourceControlController;
  iconTheme?: IconTheme;
}>(), {
  layoutMode: 'desktop',
  activity: 'explorer',
  sidebarVisible: true,
  panelVisible: true,
  panelMaximized: false,
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
  iconTheme: 'dark',
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
  togglePanelMaximize: [];
  closePanel: [];
  openSetup: [];
  openSettings: [];
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
  createFile: [payload: { name: string; language: string; folder: string }];
  createFolder: [path: string];
  searchFiles: [query: string];
  'update:creatingFile': [value: boolean];
  'update:creatingFolder': [value: boolean];
  removeFile: [path: string];
  openFolder: [];
  refreshTree: [];
  saveFile: [];
}>();
const t = useTranslation();

// The explorer owns the tree, so the header's collapse action only bumps a
// token: the explorer watches it and folds every open directory at once.
const collapseToken = ref(0);
function requestCollapse(): void {
  collapseToken.value += 1;
}

const isIde = computed(() => props.layoutMode === 'desktop');
const dirtyPaths = computed(() => props.files.filter((file) => file.dirty).map((file) => file.path));
const sidebarTitle = computed(() => {
  if (props.activity === 'runs') return t('history.title');
  if (props.activity === 'context') return t('inspector.title');
  if (props.activity === 'remote') return t('ide.activity.remote');
  if (props.activity === 'source-control') return t('ide.activity.sourceControl');
  return props.workspaceRoot?.name ?? t('ide.explorer.scratch');
});
const styles = computed(() => (isIde.value
  ? ['layout-ide', {
    'without-sidebar': !props.sidebarVisible,
    'without-panel': !props.panelVisible,
    'panel-maximized': props.panelMaximized,
  }]
  : [`layout-${props.layoutMode}`, {
    'without-history': !props.historyOpen,
    'without-inspector': !props.inspectorOpen,
  }]));
</script>

<template>
  <div class="workbench-shell" :class="styles" data-testid="workbench-shell">
    <template v-if="isIde">
      <IdeActivityBar
        :active="activity"
        :sidebar-visible="sidebarVisible"
        @select="emit('selectActivity', $event)"
        @open-settings="emit('openSettings')"
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
                @click="requestCollapse"
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
            :collapse-request="{ token: collapseToken }"
            :reveal-request="revealRequest"
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
            <RunHistory :items="history" :selected-job-id="result?.jobId" hide-heading @select="emit('selectHistory', $event)" />
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
      <section class="ide-main" :aria-label="t('workbench.source')">
        <EditorTabs v-if="files.length" :files="files" :active-path="activePath" :icon-theme="iconTheme" @select="emit('selectFile', $event)" @close="emit('closeFile', $event)" />
        <IdeBreadcrumbs
          v-if="files.length"
          :file-path="activePath"
          :root-path="workspaceRoot?.path"
          :icon-theme="iconTheme"
          @reveal="emit('revealFile', $event)"
        />
        <IdeEditorToolbar
          v-if="files.length"
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
          <section class="ide-editor" :class="{ 'ide-editor--welcome': !files.length }" :aria-label="t('workbench.editor')">
            <SourceEditor
              v-if="files.length"
              :model-value="source"
              :language="language"
              :label="t('workbench.programSource')"
              minimap
              @update:model-value="emit('update:source', $event)"
              @update:cursor="emit('update:cursor', $event)"
            />
            <EditorWelcome
              v-else
              :desktop="workspaceKind === 'desktop'"
              :platform="platform"
              @new-file="emit('update:creatingFile', true)"
              @open-folder="emit('openFolder')"
              @open-setup="emit('openSetup')"
            />
          </section>
          <JobTimeline :phase="phase" :current-job="currentJob" :error="error" :polling-stopped="pollingStopped" />
          <section v-if="panelVisible" class="ide-panel" :aria-label="t('workbench.resultOutput')">
            <IdePanelActions
              :maximized="panelMaximized"
              @toggle-maximize="emit('togglePanelMaximize')"
              @close="emit('closePanel')"
            />
            <OutputTabs
              :terminal="terminal"
              :result="result"
              :error="error"
              :model-value="activeOutputTab"
              @update:model-value="emit('update:activeOutputTab', $event)"
            />
          </section>
        </div>
        <IdeStatusBar
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
        />
      </section>
    </template>

    <template v-else>
      <RunHistory v-if="layoutMode === 'desktop' && historyOpen" :items="history" :selected-job-id="result?.jobId" @select="emit('selectHistory', $event)" />
      <SourceWorkbench
        :terminal="terminal"
        :panel-visible="terminal ? panelVisible : true"
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
    </template>
  </div>
</template>
