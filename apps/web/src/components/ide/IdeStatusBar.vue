<script setup lang="ts">
import { computed } from 'vue';
import {
  BookOpen,
  CircleX,
  Cpu,
  FolderOpen,
  History,
  LoaderCircle,
  Plug,
  Server,
  Settings,
  ShieldCheck,
  SquareTerminal,
  TriangleAlert,
} from '@lucide/vue';
import FileIcon from '../FileIcon.vue';
import { isExecutionBusy, type ExecutionBackend, type ExecutionPhase } from '../../composables/execution';
import type { ConnectionState } from '../../composables/useRunner';
import type { IconTheme } from '../../editor/fileIcon';
import { SOURCE_ENCODING, detectIndentation, detectLineEnding } from '../../editor/documentFormat';
import { languageModeLabel } from '../../editor/language';
import type { JobResponse } from '../../services/sandkastenApi';
import { runProblemCounts } from '../../state/diagnostics';
import { statusCategory } from '../../state/status';
import { useTranslation } from '../../i18n/useTranslation';

// The bottom strip follows the VS Code status bar: one slim full-width row split
// into a leading group (what is running, where, on which file, with which
// problems, plus the actions whose entry points live there) and a trailing group
// (how the file is being edited and how the last run ended). Every fact comes
// from the live workbench, so the row is a status readout rather than decoration.
const props = withDefaults(defineProps<{
  backend: ExecutionBackend;
  language: string;
  filePath?: string;
  dirty?: boolean;
  phase: ExecutionPhase;
  statusText: string;
  cursor?: { line: number; column: number };
  connectionState?: ConnectionState;
  workspaceLabel?: string;
  durationMs?: number;
  exitCode?: number;
  source?: string;
  job?: JobResponse;
  error?: string;
  apiHost?: string;
  historyCount?: number;
  terminalAvailable?: boolean;
  iconTheme?: IconTheme;
}>(), {
  dirty: false,
  connectionState: 'connecting',
  cursor: () => ({ line: 1, column: 1 }),
  source: '',
  apiHost: '',
  historyCount: 0,
  terminalAvailable: false,
  iconTheme: 'dark',
});

const emit = defineEmits<{
  openSettings: [];
  openSetup: [];
  showPanel: [];
  toggleTerminal: [];
  selectRuns: [];
  saveFile: [];
}>();

const t = useTranslation();
const BACKEND_KEYS = {
  local: 'ide.status.local',
  isolated: 'ide.status.isolated',
  api: 'ide.status.api',
} as const;
const CONNECTION_KEYS = {
  connecting: 'connection.connecting',
  connected: 'connection.connected',
  unavailable: 'connection.unavailable',
} as const;
const INDENTATION_KEYS = {
  spaces: 'ide.status.indentationSpaces',
  tabs: 'ide.status.indentationTabs',
} as const;

const busy = computed(() => isExecutionBusy(props.phase));
const backendLabel = computed(() => t(BACKEND_KEYS[props.backend]));
// The remote indicator names the thing the session is attached to: the API
// origin while the sandbox backend runs, otherwise the connection state.
const connectionLabel = computed(() => (props.backend === 'api' && props.connectionState === 'connected' && props.apiHost
  ? props.apiHost
  : t(CONNECTION_KEYS[props.connectionState])));
const connectionTitle = computed(() => `${t('settings.connectionStatus')}: ${t(CONNECTION_KEYS[props.connectionState])}`);
const activeFileName = computed(() => props.filePath.split(/[\\/]/).at(-1) ?? '');
const problems = computed(() => runProblemCounts(props.job, props.error));
const phaseState = computed(() => {
  if (busy.value) return 'busy';
  if (props.phase === 'error') return 'error';
  const category = props.job?.status ? statusCategory(props.job.status) : 'info';
  if (category === 'danger') return 'error';
  if (category === 'warning') return 'warning';
  if (category === 'success') return 'success';
  return 'idle';
});
const indentation = computed(() => detectIndentation(props.source));
const indentationLabel = computed(() => t(INDENTATION_KEYS[indentation.value.kind]));
const lineEnding = computed(() => detectLineEnding(props.source));
const modeLabel = computed(() => languageModeLabel(props.language));
const duration = computed(() => (typeof props.durationMs === 'number' ? `${(props.durationMs / 1000).toFixed(2)} s` : ''));
</script>

<template>
  <footer class="ide-status" data-testid="ide-status-bar" :data-backend="backend" :data-phase="phase">
    <div class="ide-status__group ide-status__group--start">
      <button
        type="button"
        class="ide-status__badge"
        data-action="ide-status-backend"
        :data-connection="connectionState"
        :title="`${t('ide.backend.label')}: ${backendLabel}`"
        @click="emit('openSettings')"
      >
        <LoaderCircle v-if="busy" :size="13" class="ide-status__spinner" aria-hidden="true" />
        <Cpu v-else-if="backend === 'local'" :size="13" aria-hidden="true" />
        <ShieldCheck v-else-if="backend === 'isolated'" :size="13" aria-hidden="true" />
        <Server v-else :size="13" aria-hidden="true" />
        {{ backendLabel }}
      </button>

      <button
        type="button"
        class="ide-status__item ide-status__item--connection"
        data-action="ide-status-connection"
        :data-connection="connectionState"
        :title="connectionTitle"
        @click="emit('openSettings')"
      >
        <Plug :size="12" aria-hidden="true" />
        {{ connectionLabel }}
      </button>

      <span
        v-if="workspaceLabel"
        class="ide-status__item ide-status__item--workspace"
        :title="`${t('ide.explorer.label')}: ${workspaceLabel}`"
      >
        <FolderOpen :size="12" aria-hidden="true" />
        {{ workspaceLabel }}
      </span>

      <span class="ide-status__item ide-status__item--file" :title="`${t('ide.status.file')}: ${filePath || t('ide.status.noFile')}`">
        {{ activeFileName || t('ide.status.noFile') }}
      </span>

      <button
        v-if="dirty"
        type="button"
        class="ide-status__item ide-status__item--dirty"
        data-action="ide-status-save"
        :title="t('ide.workspace.save')"
        @click="emit('saveFile')"
      >
        {{ t('ide.status.unsaved') }}
      </button>

      <button
        type="button"
        class="ide-status__item"
        data-action="ide-status-errors"
        :title="t('ide.status.errors')"
        @click="emit('showPanel')"
      >
        <CircleX :size="12" aria-hidden="true" />
        {{ problems.errors }}
      </button>
      <button
        type="button"
        class="ide-status__item"
        data-action="ide-status-warnings"
        :title="t('ide.status.warnings')"
        @click="emit('showPanel')"
      >
        <TriangleAlert :size="12" aria-hidden="true" />
        {{ problems.warnings }}
      </button>

      <button
        type="button"
        class="ide-status__item ide-status__item--action ide-status__item--secondary"
        data-action="ide-status-runs"
        :aria-label="t('history.title')"
        :title="`${t('history.title')} (${historyCount})`"
        @click="emit('selectRuns')"
      >
        <History :size="13" aria-hidden="true" />
      </button>
      <button
        v-if="terminalAvailable"
        type="button"
        class="ide-status__item ide-status__item--action ide-status__item--secondary"
        data-action="ide-status-terminal"
        :aria-label="t('terminal.title')"
        :title="t('terminal.title')"
        @click="emit('toggleTerminal')"
      >
        <SquareTerminal :size="13" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="ide-status__item ide-status__item--action ide-status__item--secondary"
        data-action="ide-status-setup"
        :aria-label="t('ide.activity.setup')"
        :title="t('ide.activity.setup')"
        @click="emit('openSetup')"
      >
        <BookOpen :size="13" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="ide-status__item ide-status__item--action ide-status__item--secondary"
        data-action="ide-status-settings"
        :aria-label="t('settings.title')"
        :title="t('settings.title')"
        @click="emit('openSettings')"
      >
        <Settings :size="13" aria-hidden="true" />
      </button>
    </div>

    <div class="ide-status__group ide-status__group--end">
      <button
        type="button"
        class="ide-status__item"
        data-action="ide-status-run"
        :data-state="phaseState"
        :title="t('ide.status.runStatus')"
        @click="emit('showPanel')"
      >
        <LoaderCircle v-if="busy" :size="12" class="ide-status__spinner" aria-hidden="true" />
        <span data-testid="ide-status-phase">{{ statusText }}</span>
      </button>
      <span v-if="duration" class="ide-status__item ide-status__item--secondary" :title="t('ide.status.duration')">{{ duration }}</span>
      <span v-if="typeof exitCode === 'number'" class="ide-status__item" :title="t('ide.status.exitCode')">
        {{ t('ide.status.exitCode') }} {{ exitCode }}
      </span>
      <span class="ide-status__item" :title="t('ide.status.cursorPosition')">
        {{ t('ide.status.line') }} {{ cursor.line }}, {{ t('ide.status.column') }} {{ cursor.column }}
      </span>
      <span class="ide-status__item" :title="t('ide.status.indentation')">{{ indentationLabel }}: {{ indentation.size }}</span>
      <span class="ide-status__item" :title="t('ide.status.encoding')">{{ SOURCE_ENCODING }}</span>
      <span class="ide-status__item" :title="t('ide.status.lineEnding')">{{ lineEnding }}</span>
      <span v-if="modeLabel" class="ide-status__item" data-testid="ide-status-language" :title="t('ide.status.languageMode')">
        <FileIcon :path="filePath" :theme="iconTheme" :size="13" />
        {{ modeLabel }}
      </span>
    </div>
  </footer>
</template>