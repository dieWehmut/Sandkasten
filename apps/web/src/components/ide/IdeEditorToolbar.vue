<script setup lang="ts">
import { computed } from 'vue';
import { Save } from '@lucide/vue';
import type { Runtime } from '../../services/sandkastenApi';
import type { ExecutionBackend, ExecutionPhase } from '../../composables/execution';
import RunControls from '../RunControls.vue';
import RuntimeSelect from '../RuntimeSelect.vue';
import DropdownSelect from '../DropdownSelect.vue';
import type { DropdownOption } from '../dropdownOptions';
import { useTranslation } from '../../i18n/useTranslation';

const props = withDefaults(defineProps<{
  runtimes: Runtime[];
  language: string;
  backend: ExecutionBackend;
  localAvailable?: boolean;
  isolatedAvailable?: boolean;
  phase: ExecutionPhase;
  canRun: boolean;
  canResume?: boolean;
  dirty?: boolean;
  disabled?: boolean;
}>(), { localAvailable: false, isolatedAvailable: false, canResume: false, dirty: false, disabled: false });

const emit = defineEmits<{
  'update:language': [language: string];
  'update:backend': [backend: ExecutionBackend];
  run: [];
  stop: [];
  resume: [];
  save: [];
}>();

const t = useTranslation();

// The hint explains the *selected* backend, because the two local backends
// differ in what the user is about to run: one uses the host toolchain, the
// other a namespace sandbox inside WSL2.
const backendHint = computed(() => {
  if (props.backend === 'api') return t('ide.backend.apiHint');
  if (props.backend === 'isolated') {
    return props.isolatedAvailable ? t('ide.backend.isolatedHint') : t('ide.backend.isolatedUnavailable');
  }
  return props.localAvailable ? t('ide.backend.hint') : t('ide.backend.localUnavailable');
});

// One row per backend, each carrying the hint for *itself*: the trigger's title
// already explains the selected one, so the rows explain what choosing them does.
const backendOptions = computed<DropdownOption[]>(() => [
  {
    value: 'local',
    label: t('ide.backend.local'),
    hint: props.localAvailable ? t('ide.backend.hint') : t('ide.backend.localUnavailable'),
    disabled: !props.localAvailable,
  },
  {
    value: 'isolated',
    label: t('ide.backend.isolated'),
    hint: props.isolatedAvailable ? t('ide.backend.isolatedHint') : t('ide.backend.isolatedUnavailable'),
    disabled: !props.isolatedAvailable,
  },
  { value: 'api', label: t('ide.backend.api'), hint: t('ide.backend.apiHint') },
]);
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
      <div class="ide-backend" :title="backendHint">
        <span class="ide-backend__label">{{ t('ide.backend.label') }}</span>
        <DropdownSelect
          :model-value="backend"
          :options="backendOptions"
          :label="t('ide.backend.label')"
          data-testid="ide-backend-select"
          @update:model-value="emit('update:backend', $event as ExecutionBackend)"
        />
      </div>
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
