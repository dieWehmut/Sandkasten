<script setup lang="ts">
import { Save } from '@lucide/vue';
import type { Runtime } from '../../services/sandkastenApi';
import type { ExecutionBackend, ExecutionPhase } from '../../composables/execution';
import RunControls from '../RunControls.vue';
import RuntimeSelect from '../RuntimeSelect.vue';
import { useTranslation } from '../../i18n/useTranslation';

const props = withDefaults(defineProps<{
  runtimes: Runtime[];
  language: string;
  backend: ExecutionBackend;
  localAvailable?: boolean;
  phase: ExecutionPhase;
  canRun: boolean;
  canResume?: boolean;
  dirty?: boolean;
  disabled?: boolean;
}>(), { localAvailable: false, canResume: false, dirty: false, disabled: false });

const emit = defineEmits<{
  'update:language': [language: string];
  'update:backend': [backend: ExecutionBackend];
  run: [];
  stop: [];
  resume: [];
  save: [];
}>();

const t = useTranslation();
</script>

<template>
  <header class="ide-toolbar" data-testid="ide-toolbar">
    <RuntimeSelect
      :model-value="language"
      :runtimes="runtimes"
      :disabled="disabled"
      @update:model-value="emit('update:language', $event)"
    />
    <div class="ide-toolbar__actions">
      <label class="ide-backend" :title="localAvailable ? t('ide.backend.hint') : t('ide.backend.localUnavailable')">
        <span class="ide-backend__label">{{ t('ide.backend.label') }}</span>
        <select
          :value="backend"
          :aria-label="t('ide.backend.label')"
          data-testid="ide-backend-select"
          @change="emit('update:backend', ($event.target as HTMLSelectElement).value as ExecutionBackend)"
        >
          <option value="local" :disabled="!localAvailable">{{ t('ide.backend.local') }}</option>
          <option value="api">{{ t('ide.backend.api') }}</option>
        </select>
      </label>
      <button
        v-if="dirty"
        type="button"
        class="ide-save"
        data-action="ide-save-file"
        :aria-label="t('ide.workspace.save')"
        :title="t('ide.workspace.save')"
        @click="emit('save')"
      >
        <Save :size="16" aria-hidden="true" />
        <span>{{ t('ide.workspace.save') }}</span>
      </button>
      <RunControls
        :phase="phase"
        :can-run="canRun"
        :can-resume="canResume"
        @run="emit('run')"
        @stop="emit('stop')"
        @resume="emit('resume')"
      />
    </div>
  </header>
</template>