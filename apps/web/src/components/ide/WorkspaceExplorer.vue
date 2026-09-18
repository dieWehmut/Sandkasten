<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ChevronDown, ChevronRight, FilePlus, FolderOpen, RefreshCw, Trash2, X } from '@lucide/vue';
import type { WorkspaceRoot, WorkspaceTreeNode } from '../../services/desktopBridge';
import type { Runtime } from '../../services/sandkastenApi';
import { languageForPath } from '../../editor/language';
import { useTranslation } from '../../i18n/useTranslation';
import FileIcon from '../FileIcon.vue';

const props = withDefaults(defineProps<{
  tree: WorkspaceTreeNode[];
  root?: WorkspaceRoot;
  kind: 'memory' | 'desktop';
  activePath: string;
  dirtyPaths?: string[];
  busy?: boolean;
  error?: string;
  runtimes?: Runtime[];
  creating?: boolean;
  hideHeading?: boolean;
  revealRequest?: { path: string; token: number };
}>(), { dirtyPaths: () => [], runtimes: () => [], busy: false, creating: false, hideHeading: false });

const emit = defineEmits<{
  select: [path: string];
  openFolder: [];
  refresh: [];
  create: [payload: { name: string; language: string }];
  remove: [path: string];
  'update:creating': [value: boolean];
}>();

const t = useTranslation();
const collapsed = ref<string[]>([]);
const draftName = ref('');
const draftLanguage = ref('python');

// A breadcrumb click asks the tree to show a directory that may be folded, so
// the request opens that directory and everything above it.
watch(() => props.revealRequest?.token, () => {
  const path = props.revealRequest?.path;
  if (!path) return;
  collapsed.value = collapsed.value.filter((entry) => (
    entry !== path && !path.startsWith(`${entry}/`)
  ));
});

const FALLBACK_LANGUAGES = ['python', 'javascript', 'typescript', 'go', 'rust', 'c', 'cpp', 'java', 'bash'];

const languageOptions = computed(() => {
  const languages = props.runtimes.map((runtime) => runtime.language).filter(Boolean);
  return languages.length ? languages : FALLBACK_LANGUAGES;
});

interface Row {
  node: WorkspaceTreeNode;
  depth: number;
}

const rows = computed<Row[]>(() => {
  const output: Row[] = [];
  const walk = (nodes: readonly WorkspaceTreeNode[], depth: number): void => {
    for (const node of nodes) {
      output.push({ node, depth });
      if (node.type !== 'directory' || collapsed.value.includes(node.path)) continue;
      if (node.children?.length) walk(node.children, depth + 1);
    }
  };
  walk(props.tree, 0);
  return output;
});

function isCollapsed(path: string): boolean {
  return collapsed.value.includes(path);
}

function toggleDirectory(path: string): void {
  collapsed.value = isCollapsed(path) ? collapsed.value.filter((entry) => entry !== path) : [...collapsed.value, path];
}

function startCreating(): void {
  draftName.value = '';
  draftLanguage.value = languageOptions.value[0] ?? 'python';
  emit('update:creating', true);
}

function submitNewFile(): void {
  const name = draftName.value.trim();
  if (!name) return;
  emit('create', { name, language: draftLanguage.value });
  emit('update:creating', false);
  draftName.value = '';
}
</script>

<template>
  <section class="ide-explorer" data-testid="workspace-explorer" :aria-label="t('ide.explorer.label')">
    <header v-if="!hideHeading" class="ide-section__heading">
      <span class="ide-section__title" :title="root?.path ?? root?.name">{{ root?.name ?? t('ide.explorer.scratch') }}</span>
      <span class="ide-section__actions">
        <button type="button" data-action="ide-new-file" :aria-label="t('ide.explorer.newFile')" :title="t('ide.explorer.newFile')" @click="startCreating">
          <FilePlus :size="15" aria-hidden="true" />
        </button>
        <button v-if="kind === 'desktop'" type="button" data-action="ide-open-folder" :aria-label="t('ide.explorer.openFolder')" :title="t('ide.explorer.openFolder')" @click="emit('openFolder')">
          <FolderOpen :size="15" aria-hidden="true" />
        </button>
        <button type="button" data-action="ide-refresh-tree" :aria-label="t('ide.explorer.refresh')" :title="t('ide.explorer.refresh')" :disabled="busy" @click="emit('refresh')">
          <RefreshCw :size="15" aria-hidden="true" />
        </button>
      </span>
    </header>

    <form v-if="creating" class="ide-new-file" data-testid="ide-new-file-form" @submit.prevent="submitNewFile">
      <input
        v-model="draftName"
        type="text"
        name="fileName"
        :placeholder="t('ide.explorer.fileNamePlaceholder')"
        :aria-label="t('ide.explorer.fileName')"
        autofocus
      >
      <div class="ide-new-file__row">
        <select v-model="draftLanguage" :aria-label="t('workbench.runtime')">
          <option v-for="language in languageOptions" :key="language" :value="language">{{ language }}</option>
        </select>
        <button type="submit" data-action="ide-create-file">{{ t('ide.explorer.create') }}</button>
        <button type="button" data-action="ide-cancel-create" :aria-label="t('ide.explorer.cancel')" @click="emit('update:creating', false)">
          <X :size="15" aria-hidden="true" />
        </button>
      </div>
    </form>

    <p v-if="error" class="ide-explorer__error" role="alert">{{ error }}</p>
    <p v-if="!rows.length" class="empty-state ide-explorer__empty">{{ t('ide.explorer.empty') }}</p>
    <ul v-else class="ide-tree" role="tree" :aria-label="t('ide.explorer.tree')">
      <li
        v-for="row in rows"
        :key="row.node.path"
        role="treeitem"
        :aria-level="row.depth + 1"
        :aria-selected="activePath === row.node.path"
        :data-path="row.node.path"
      >
        <div v-if="row.node.type === 'directory'" class="ide-tree__row ide-tree__row--directory" :style="{ paddingLeft: `${8 + row.depth * 12}px` }">
          <button type="button" class="ide-tree__toggle" :aria-expanded="!isCollapsed(row.node.path)" @click="toggleDirectory(row.node.path)">
            <ChevronDown v-if="!isCollapsed(row.node.path)" :size="14" aria-hidden="true" />
            <ChevronRight v-else :size="14" aria-hidden="true" />
            <span class="ide-tree__name">{{ row.node.name }}</span>
          </button>
        </div>
        <div
          v-else
          class="ide-tree__row"
          :class="{ 'ide-tree__row--active': activePath === row.node.path }"
          :style="{ paddingLeft: `${8 + row.depth * 12}px` }"
        >
          <button type="button" class="ide-tree__open" :data-action="`ide-open-${row.node.path}`" @click="emit('select', row.node.path)">
            <FileIcon :language="languageForPath(row.node.path)" :name="row.node.name" :size="14" />
            <span class="ide-tree__name">{{ row.node.name }}</span>
            <span v-if="dirtyPaths.includes(row.node.path)" class="ide-tree__dirty" :aria-label="t('ide.tabs.unsaved')">*</span>
          </button>
          <button
            type="button"
            class="ide-tree__remove"
            :aria-label="t('ide.explorer.deleteFile')"
            :title="t('ide.explorer.deleteFile')"
            @click="emit('remove', row.node.path)"
          >
            <Trash2 :size="13" aria-hidden="true" />
          </button>
        </div>
      </li>
    </ul>
  </section>
</template>
