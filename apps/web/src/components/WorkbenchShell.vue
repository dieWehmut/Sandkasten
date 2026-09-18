<script setup lang="ts">
import { computed } from 'vue';
import type { DeepReadonly } from 'vue';
import { FilePlus, FolderOpen, PanelLeftClose, RefreshCw } from '@lucide/vue';
import type { OutputTab } from '../composables/useRunner';
import type { ConnectionState } from '../composables/useRunner';
import type { ExecutionBackend, ExecutionPhase } from '../composables/execution';
import type { IdeActivity } from '../composables/useIdeLayout';
import type { WorkspaceFile } from '../composables/useWorkspace';
import type { RunHistoryItem } from '../composables/useRunHistory';
import type { JobResponse, Runtime } from '../services/sandkastenApi';
import type { LocalRuntimeInfo, WorkspaceRoot, WorkspaceTreeNode } from '../services/desktopBridge';
import type { LayoutMode } from '../composables/useMediaLayout';
import EdgeSheet from './EdgeSheet.vue';
import InspectorPanel from './InspectorPanel.vue';
import JobTimeline from './JobTimeline.vue';
import OutputTabs from './OutputTabs.vue';
import RunHistory from './RunHistory.vue';
import SourceEditor from './SourceEditor.vue';
import SourceWorkbench from './SourceWorkbench.vue';
import EditorTabs from './ide/EditorTabs.vue';
import IdeActivityBar from './ide/IdeActivityBar.vue';
import IdeEditorToolbar from './ide/IdeEditorToolbar.vue';
import IdeStatusBar from './ide/IdeStatusBar.vue';
import WorkspaceExplorer from './ide/WorkspaceExplorer.vue';
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
  files?: readonly WorkspaceFile[];
  activePath?: string;
  tree?: WorkspaceTreeNode[];
  workspaceRoot?: WorkspaceRoot;
  workspaceKind?: 'memory' | 'desktop';
  workspaceBusy?: boolean;
  workspaceError?: string;
  creatingFile?: boolean;
  backend?: ExecutionBackend;
  localAvailable?: boolean;
  isolatedAvailable?: boolean;
  localRuntimes?: LocalRuntimeInfo[];
  cursor?: { line: number; column: number };
  statusText?: string;
  connectionState?: ConnectionState;
  workspaceLabel?: string;
}>(), {
  layoutMode: 'desktop',
  activity: 'explorer',
  sidebarVisible: true,
  panelVisible: true,
  files: () => [],
  activePath: '',
  tree: () => [],
  workspaceKind: 'memory',
  workspaceBusy: false,
  creatingFile: false,
  backend: 'api',
  localAvailable: false,
  isolatedAvailable: false,
  localRuntimes: () => [],
  cursor: () => ({ line: 1, column: 1 }),
  statusText: 'Ready',
  connectionState: 'connecting',
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
  openSetup: [];
  selectFile: [path: string];
  closeFile: [path: string];
  createFile: [payload: { name: string; language: string }];
  'update:creatingFile': [value: boolean];
  removeFile: [path: string];
  openFolder: [];
  refreshTree: [];
  saveFile: [];
}>();
const t = useTranslation();

const isIde = computed(() => props.layoutMode === 'desktop');
const dirtyPaths = computed(() => props.files.filter((file) => file.dirty).map((file) => file.path));
const sidebarTitle = computed(() => {
  if (props.activity === 'runs') return t('history.title');
  if (props.activity === 'context') return t('inspector.title');
  return props.workspaceRoot?.name ?? t('ide.explorer.scratch');
});
const styles = computed(() => (isIde.value
  ? ['layout-ide', {
    'without-sidebar': !props.sidebarVisible,
    'without-panel': !props.panelVisible,
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
        @open-setup="emit('openSetup')"
      />
      <aside v-if="sidebarVisible" class="ide-sidebar" :aria-label="t('ide.sidebar.label')">
        <header class="ide-sidebar__header">
          <span class="ide-sidebar__title" :title="workspaceRoot?.path ?? sidebarTitle">{{ sidebarTitle }}</span>
          <span class="ide-sidebar__actions">
            <template v-if="activity === 'explorer'">
              <button type="button" data-action="ide-new-file" :aria-label="t('ide.explorer.newFile')" :title="t('ide.explorer.newFile')" @click="emit('update:creatingFile', true)">
                <FilePlus :size="15" aria-hidden="true" />
              </button>
              <button v-if="workspaceKind === 'desktop'" type="button" data-action="ide-open-folder" :aria-label="t('ide.explorer.openFolder')" :title="t('ide.explorer.openFolder')" @click="emit('openFolder')">
                <FolderOpen :size="15" aria-hidden="true" />
              </button>
              <button type="button" data-action="ide-refresh-tree" :aria-label="t('ide.explorer.refresh')" :title="t('ide.explorer.refresh')" :disabled="workspaceBusy" @click="emit('refreshTree')">
                <RefreshCw :size="15" aria-hidden="true" />
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
            hide-heading
            @update:creating="emit('update:creatingFile', $event)"
            @select="emit('selectFile', $event)"
            @open-folder="emit('openFolder')"
            @refresh="emit('refreshTree')"
            @create="emit('createFile', $event)"
            @remove="emit('removeFile', $event)"
          />
          <section class="ide-sidebar__section" :aria-label="t('history.title')">
            <RunHistory :items="history" :selected-job-id="result?.jobId" hide-heading @select="emit('selectHistory', $event)" />
          </section>
        </template>
        <RunHistory v-else-if="activity === 'runs'" :items="history" :selected-job-id="result?.jobId" hide-heading @select="emit('selectHistory', $event)" />
        <InspectorPanel v-else :runtime="runtime" :job="result" :error="error" hide-heading />
      </aside>
      <section class="ide-main" :aria-label="t('workbench.source')">
        <EditorTabs :files="files" :active-path="activePath" @select="emit('selectFile', $event)" @close="emit('closeFile', $event)" />
        <IdeEditorToolbar
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
          <section class="ide-editor" :aria-label="t('workbench.editor')">
            <SourceEditor
              v-if="files.length"
              :model-value="source"
              :language="language"
              :label="t('workbench.programSource')"
              @update:model-value="emit('update:source', $event)"
              @update:cursor="emit('update:cursor', $event)"
            />
            <p v-else class="empty-state ide-editor__empty">{{ t('ide.editor.empty') }}</p>
          </section>
          <JobTimeline :phase="phase" :current-job="currentJob" :error="error" :polling-stopped="pollingStopped" />
          <section v-if="panelVisible" class="ide-panel" :aria-label="t('workbench.resultOutput')">
            <OutputTabs
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
