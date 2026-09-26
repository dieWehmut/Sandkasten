<script setup lang="ts">
import { computed, ref } from 'vue';
import { ChevronRight } from '@lucide/vue';
import { breadcrumbSegments, siblingEntries, type BreadcrumbEntry } from '../../editor/breadcrumbs';
import type { WorkspaceTreeNode } from '../../services/desktopBridge';
import type { IconTheme } from '../../editor/fileIcon';
import { useTranslation } from '../../i18n/useTranslation';
import FileIcon from '../FileIcon.vue';
import IdeBreadcrumbPicker from './IdeBreadcrumbPicker.vue';

// The trail above the editor. Folder steps open the reference's picker (the
// siblings of that step) instead of only revealing the folder, so a file can be
// reached sideways; choosing a folder still reveals it in the explorer.
const props = withDefaults(defineProps<{
  filePath?: string;
  rootPath?: string;
  tree?: readonly WorkspaceTreeNode[];
  iconTheme?: IconTheme;
}>(), { filePath: '', rootPath: '', tree: () => [], iconTheme: 'dark' });

const emit = defineEmits<{
  reveal: [path: string];
  select: [path: string];
}>();

const t = useTranslation();
const segments = computed(() => breadcrumbSegments(props.filePath, props.rootPath));
const picker = ref<{ open: boolean; entries: BreadcrumbEntry[]; path: string; x: number; y: number; arrowOffset: number }>({
  open: false, entries: [], path: '', x: 0, y: 0, arrowOffset: 16,
});
// The step that opened the picker, so closing it hands focus back to the trail.
let opener: HTMLElement | undefined;

function openPicker(segment: { path: string; kind: string }, event: MouseEvent): void {
  const target = event.currentTarget as HTMLElement | null;
  const box = target?.getBoundingClientRect();
  const entries = siblingEntries(props.tree, segment.path);
  opener = target ?? undefined;
  picker.value = {
    open: entries.length > 0,
    entries,
    path: segment.kind === 'root' ? '' : segment.path,
    x: box?.left ?? 0,
    y: (box?.bottom ?? 0) + 2,
    arrowOffset: (box?.width ?? 32) / 2,
  };
}

function closePicker(): void {
  picker.value = { ...picker.value, open: false };
  if (opener?.isConnected) opener.focus();
  opener = undefined;
}

function chooseEntry(entry: BreadcrumbEntry): void {
  picker.value = { ...picker.value, open: false };
  opener = undefined;
  if (entry.kind === 'directory') emit('reveal', entry.path);
  else emit('select', entry.path);
}
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
        v-if="segment.kind !== 'file'"
        type="button"
        class="ide-breadcrumbs__step"
        :data-segment="segment.name"
        :aria-haspopup="'true'"
        :aria-expanded="picker.open && picker.path === (segment.kind === 'root' ? '' : segment.path)"
        @click="openPicker(segment, $event)"
      >
        <FileIcon v-if="segment.kind === 'directory'" kind="folder" :name="segment.name" expanded :theme="iconTheme" :size="15" />
        {{ segment.name }}
      </button>
      <span v-else class="ide-breadcrumbs__step ide-breadcrumbs__step--static" :data-segment="segment.name">
        <FileIcon v-if="segment.kind === 'file'" :path="filePath" :name="segment.name" :theme="iconTheme" :size="14" />
        {{ segment.name }}
      </span>
    </template>
    <IdeBreadcrumbPicker
      :open="picker.open"
      :entries="picker.entries"
      :active-path="picker.path"
      :x="picker.x"
      :y="picker.y"
      :arrow-offset="picker.arrowOffset"
      :label="t('ide.breadcrumbs.picker')"
      :icon-theme="iconTheme"
      @select="chooseEntry"
      @close="closePicker"
    />
  </nav>
</template>