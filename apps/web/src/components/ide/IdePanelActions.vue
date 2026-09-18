<script setup lang="ts">
import { ChevronDown, ChevronUp, X } from '@lucide/vue';
import { useTranslation } from '../../i18n/useTranslation';

defineProps<{ maximized: boolean }>();
const emit = defineEmits<{ toggleMaximize: []; close: [] }>();
const t = useTranslation();
</script>

<template>
  <div class="ide-panel__header">
    <button
      type="button"
      class="ide-panel__action"
      data-action="ide-panel-maximize"
      :aria-label="maximized ? t('ide.panel.restore') : t('ide.panel.maximize')"
      :title="maximized ? t('ide.panel.restore') : t('ide.panel.maximize')"
      :aria-pressed="maximized"
      @click="emit('toggleMaximize')"
    >
      <ChevronDown v-if="maximized" :size="14" aria-hidden="true" />
      <ChevronUp v-else :size="14" aria-hidden="true" />
    </button>
    <button
      type="button"
      class="ide-panel__action"
      data-action="ide-panel-close"
      :aria-label="t('ide.panel.close')"
      :title="t('ide.panel.close')"
      @click="emit('close')"
    >
      <X :size="14" aria-hidden="true" />
    </button>
  </div>
</template>