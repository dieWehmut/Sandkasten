<script setup lang="ts">
import { X } from '@lucide/vue';
import { languageForPath } from '../../editor/language';
import { useTranslation } from '../../i18n/useTranslation';
import FileIcon from '../FileIcon.vue';

defineProps<{
  files: ReadonlyArray<{ path: string; name: string; dirty: boolean }>;
  activePath: string;
}>();
const emit = defineEmits<{ select: [path: string]; close: [path: string] }>();
const t = useTranslation();
</script>

<template>
  <div class="ide-tabs" role="tablist" :aria-label="t('ide.tabs.label')" data-testid="editor-tabs">
    <p v-if="!files.length" class="ide-tabs__empty">{{ t('ide.tabs.empty') }}</p>
    <div
      v-for="file in files"
      :key="file.path"
      class="ide-tab"
      :class="{ 'ide-tab--active': file.path === activePath }"
    >
      <button
        type="button"
        role="tab"
        class="ide-tab__select"
        :data-action="`ide-tab-${file.path}`"
        :aria-selected="file.path === activePath"
        :title="file.path"
        @click="emit('select', file.path)"
      >
        <FileIcon :language="languageForPath(file.path)" :name="file.name" :size="15" />
        <span class="ide-tab__name">{{ file.name }}</span>
        <span v-if="file.dirty" class="ide-tab__dirty" :aria-label="t('ide.tabs.unsaved')">*</span>
      </button>
      <button
        type="button"
        class="ide-tab__close"
        :data-action="`ide-close-${file.path}`"
        :aria-label="t('ide.tabs.close')"
        :title="t('ide.tabs.close')"
        @click="emit('close', file.path)"
      >
        <X :size="13" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
