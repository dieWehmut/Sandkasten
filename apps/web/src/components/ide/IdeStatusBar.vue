<script setup lang="ts">
import { computed } from 'vue';
import { Cpu, Server } from '@lucide/vue';
import type { ExecutionBackend, ExecutionPhase } from '../../composables/execution';
import type { ConnectionState } from '../../composables/useRunner';
import { useTranslation } from '../../i18n/useTranslation';

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
}>(), { dirty: false, connectionState: 'connecting', cursor: () => ({ line: 1, column: 1 }) });

const t = useTranslation();
const backendLabel = computed(() => t(props.backend === 'local' ? 'ide.status.local' : 'ide.status.api'));
const duration = computed(() => (typeof props.durationMs === 'number' ? `${(props.durationMs / 1000).toFixed(2)} s` : ''));
</script>

<template>
  <footer class="ide-status" data-testid="ide-status-bar" :data-backend="backend">
    <span class="ide-status__group">
      <span class="ide-status__badge" :data-connection="connectionState">
        <Cpu v-if="backend === 'local'" :size="13" aria-hidden="true" />
        <Server v-else :size="13" aria-hidden="true" />
        {{ backendLabel }}
      </span>
      <span v-if="workspaceLabel" class="ide-status__item">{{ workspaceLabel }}</span>
    </span>
    <span class="ide-status__group ide-status__group--center">
      <span class="ide-status__item">{{ filePath || t('ide.status.noFile') }}</span>
      <span v-if="dirty" class="ide-status__item ide-status__item--dirty">{{ t('ide.status.unsaved') }}</span>
    </span>
    <span class="ide-status__group ide-status__group--end">
      <span v-if="language" class="ide-status__item">{{ language }}</span>
      <span class="ide-status__item" data-testid="ide-status-phase">{{ statusText }}</span>
      <span v-if="duration" class="ide-status__item">{{ duration }}</span>
      <span v-if="typeof exitCode === 'number'" class="ide-status__item">{{ t('ide.status.exitCode') }} {{ exitCode }}</span>
      <span class="ide-status__item">{{ t('ide.status.cursor') }} {{ cursor.line }}, {{ cursor.column }}</span>
    </span>
  </footer>
</template>