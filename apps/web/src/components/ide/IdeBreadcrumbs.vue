<script setup lang="ts">
import { computed } from 'vue';
import { ChevronRight } from '@lucide/vue';
import { breadcrumbSegments } from '../../editor/breadcrumbs';
import { languageForPath } from '../../editor/language';
import { useTranslation } from '../../i18n/useTranslation';
import FileIcon from '../FileIcon.vue';

const props = withDefaults(defineProps<{
  filePath?: string;
  rootPath?: string;
}>(), { filePath: '', rootPath: '' });

const emit = defineEmits<{ reveal: [path: string] }>();

const t = useTranslation();
const segments = computed(() => breadcrumbSegments(props.filePath, props.rootPath));
</script>

<template>
  <nav
    v-if="segments.length"
    class="ide-breadcrumbs"
    data-testid="ide-breadcrumbs"
    :aria-label="t('ide.breadcrumbs.label')"
    :title="filePath"
  >
    <template v-for="(segment, index) in segments" :key="`${segment.kind}-${segment.path}-${segment.name}`">
      <ChevronRight v-if="index" class="ide-breadcrumbs__separator" :size="13" aria-hidden="true" />
      <button
        v-if="segment.kind === 'directory'"
        type="button"
        class="ide-breadcrumbs__step"
        :data-segment="segment.name"
        @click="emit('reveal', segment.path)"
      >{{ segment.name }}</button>
      <span v-else class="ide-breadcrumbs__step ide-breadcrumbs__step--static" :data-segment="segment.name">
        <FileIcon v-if="segment.kind === 'file'" :language="languageForPath(filePath)" :name="segment.name" :size="14" />
        {{ segment.name }}
      </span>
    </template>
  </nav>
</template>