<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { Check, ChevronDown, ChevronRight, FilePlus, FolderPlus, ListCollapse, RefreshCw, Trash2, X } from '@lucide/vue';
import type { WorkspaceRoot, WorkspaceTreeNode } from '../../services/desktopBridge';
import type { Runtime } from '../../services/sandkastenApi';
import type { IconTheme } from '../../editor/fileIcon';
import { ancestorPaths } from '../../editor/breadcrumbs';
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
  creatingFolder?: boolean;
  hideHeading?: boolean;
  collapseRequest?: { token: number };
  revealRequest?: { path: string; token: number };
  iconTheme?: IconTheme;
}>(), { dirtyPaths: () => [], runtimes: () => [], busy: false, creating: false, creatingFolder: false, hideHeading: false, collapseRequest: () => ({ token: 0 }), iconTheme: 'dark' });

const emit = defineEmits<{
  select: [path: string];
  openFolder: [];
  refresh: [];
  create: [payload: { name: string; language: string; folder: string }];
  createFolder: [path: string];
  remove: [path: string];
  'update:creating': [value: boolean];
  'update:creatingFolder': [value: boolean];
}>();

const t = useTranslation();
const collapsed = ref<string[]>([]);
const draftName = ref('');
const draftLanguage = ref('python');
const draftFolderPath = ref('');

// The creation row belongs to one directory: the one that holds the selection,
// or the selection itself when a folder is chosen. VS Code behaves the same way,
// so a new file lands next to what the user was looking at instead of at the
// top of the panel.
type CreateTarget = { parent: string; depth: number };

const createTarget = ref<CreateTarget | null>(null);
const createKind = ref<'file' | 'folder'>('file');
const createRowOpen = ref(false);

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


// Where the inline row sits in the flat row list: after the directory that
// holds it, or before everything when it belongs to the root.
const inlineInsertAt = computed<number>(() => {
  const parent = createTarget.value?.parent ?? '';
  if (!parent) return 0;
  const index = rows.value.findIndex((row) => row.node.type === 'directory' && row.node.path === parent);
  return index === -1 ? 0 : index + 1;
});

const inlineRowVisible = computed(() => createTarget.value !== null
  && (createRowOpen.value || props.creating || props.creatingFolder));

// The tree renders from one flat list so the creation row can take a slot in
// it; a nested form inside each directory would duplicate the row's markup.
interface DisplayRow extends Row { create?: 'file' | 'folder' }

const displayRows = computed<DisplayRow[]>(() => {
  if (!inlineRowVisible.value || !createTarget.value) return rows.value;
  const output: DisplayRow[] = [...rows.value];
  output.splice(inlineInsertAt.value, 0, {
    node: { path: `${createTarget.value.parent}#create`, name: '', type: 'file' },
    depth: createTarget.value.depth,
    create: createKind.value,
  });
  return output;
});

function isCollapsed(path: string): boolean {
  return collapsed.value.includes(path);
}

function toggleDirectory(path: string): void {
  collapsed.value = isCollapsed(path) ? collapsed.value.filter((entry) => entry !== path) : [...collapsed.value, path];
}

// A directory selection creates inside it; a file selection creates beside it.
// The selection may name a directory rather than an open file, and the row then
// belongs to that directory itself instead of to a sibling of the same name.
function targetForSelection(): CreateTarget {
  if (props.activePath && directoryPaths.value.includes(props.activePath)) {
    return { parent: props.activePath, depth: props.activePath.split('/').length };
  }
  const segments = props.activePath.split('/').filter(Boolean);
  const filePath = segments.length > 1 ? segments.slice(0, -1).join('/') : '';
  const parent = directoryPaths.value.includes(filePath) ? filePath : '';
  const depth = parent === '' ? 0 : parent.split('/').length;
  return { parent, depth };
}

// The row must be visible even when its directory is folded, so opening it
// unfolds the directory and every directory above it.
function revealTarget(target: CreateTarget): void {
  if (!target.parent) return;
  const ancestors = [target.parent, ...ancestorPaths(target.parent)];
  collapsed.value = collapsed.value.filter((entry) => !ancestors.includes(entry));
}

function startCreating(): void {
  draftName.value = '';
  draftLanguage.value = languageOptions.value[0] ?? 'python';
  createKind.value = 'file';
  createTarget.value = targetForSelection();
  createRowOpen.value = true;
  revealTarget(createTarget.value);
  emit('update:creating', true);
}

// The panel keeps its own form flag so the folder form also opens when the
// explorer is mounted on its own; the shell mirrors the flag for its button.
const folderFormOpen = ref(false);

function startCreatingFolder(): void {
  draftFolderPath.value = '';
  createKind.value = 'folder';
  createTarget.value = targetForSelection();
  createRowOpen.value = true;
  revealTarget(createTarget.value);
  folderFormOpen.value = true;
  emit('update:creatingFolder', true);
}

// One row drives both kinds, so closing it has to release both shell flags.
function closeCreateRow(): void {
  createTarget.value = null;
  createRowOpen.value = false;
  folderFormOpen.value = false;
  emit('update:creating', false);
  emit('update:creatingFolder', false);
}

function cancelCreatingFolder(): void {
  draftFolderPath.value = '';
  closeCreateRow();
}

function submitInlineCreate(): void {
  if (createKind.value === 'file') submitNewFile();
  else submitNewFolder();
}

// The row is short-lived, so focus follows it: opening focuses the field, and a
// failed submit keeps the caret where the user left it.
// A string ref inside v-for collects an array, so take the element directly.
const createInput = ref<HTMLInputElement | null>(null);
function setCreateInput(element: unknown): void {
  createInput.value = (element as HTMLInputElement | null) ?? null;
}
watch(inlineRowVisible, async (visible) => {
  if (!visible) return;
  await nextTick();
  createInput.value?.focus?.();
});

function submitNewFile(): void {
  const name = draftName.value.trim();
  if (!name) return;
  // The location is the row's own directory; a typed prefix still nests the
  // file further, and the store re-validates every segment either way.
  const typed = name.replaceAll('\\', '/').replace(/^[/]+|[/]+$/g, '');
  const folder = [createTarget.value?.parent ?? '', typed.includes('/') ? typed.slice(0, typed.lastIndexOf('/')) : '']
    .filter(Boolean)
    .join('/');
  const leaf = typed.includes('/') ? typed.slice(typed.lastIndexOf('/') + 1) : typed;
  if (!leaf) return;
  emit('create', { name: leaf, language: draftLanguage.value, folder });
  closeCreateRow();
  draftName.value = '';
}

function submitNewFolder(): void {
  const path = draftFolderPath.value.trim();
  if (!path) return;
  // A bare name creates in the row's directory; a typed path still nests.
  const parent = createTarget.value?.parent ?? '';
  const target = path.includes('/') || !parent ? path : `${parent}/${path}`;
  emit('createFolder', target);
  closeCreateRow();
  draftFolderPath.value = '';
}

// Collapse folders is the reference's fourth header action: every directory
// folds at once, including the nested ones a user opened inside a branch.
const directoryPaths = computed(() => {
  const output: string[] = [];
  const walk = (nodes: readonly WorkspaceTreeNode[]): void => {
    for (const node of nodes) {
      if (node.type !== 'directory') continue;
      output.push(node.path);
      if (node.children?.length) walk(node.children);
    }
  };
  walk(props.tree);
  return output;
});
const allCollapsed = computed(() => directoryPaths.value.length > 0
  && directoryPaths.value.every((path) => collapsed.value.includes(path)));

function foldAll(): void {
  collapsed.value = [...directoryPaths.value];
}

function collapseAll(): void {
  if (allCollapsed.value) collapsed.value = [];
  else foldAll();
}

// The shell header carries the same collapse action when it hides this heading,
// so a bumped token folds the tree exactly like the button inside this panel.
watch(() => props.collapseRequest.token, () => foldAll());

// The shell's header drives the same row when it hides this panel's heading, so
// a flag that arrives without a target still gets the selection's location. A
// flag for the other kind also switches an open row, because the header offers
// both buttons at once and the row has to follow the button that was pressed.
// It runs immediately because a hidden sidebar can mount this panel while the
// flag is already set, and a fresh mount must still show the row.
watch(() => [props.creating, props.creatingFolder], ([creating, creatingFolder], previous) => {
  const kind = creating ? 'file' as const : creatingFolder ? 'folder' as const : null;
  if (!kind) {
    // A flag that clears while the row was only open through the shell closes it.
    if (!createRowOpen.value) return;
    if (previous?.[0] && !creating && !creatingFolder) closeCreateRow();
    return;
  }
  createRowOpen.value = true;
  createKind.value = kind;
  if (!createTarget.value || previous === undefined) {
    createTarget.value = targetForSelection();
  }
  revealTarget(createTarget.value);
}, { immediate: true });
</script>

<template>
  <section class="ide-explorer" data-testid="workspace-explorer" :aria-label="t('ide.explorer.label')">
    <header v-if="!hideHeading" class="ide-section__heading">
      <span class="ide-section__title" :title="root?.path ?? root?.name">{{ root?.name ?? t('ide.explorer.scratch') }}</span>
      <span class="ide-section__actions ide-explorer__actions" data-testid="ide-explorer-actions">
        <button type="button" data-action="ide-new-file" :aria-label="t('ide.explorer.newFile')" :title="t('ide.explorer.newFile')" :aria-pressed="inlineRowVisible && createKind === 'file'" @click="startCreating">
          <FilePlus :size="15" aria-hidden="true" />
        </button>
        <button type="button" data-action="ide-new-folder" :aria-label="t('ide.explorer.newFolder')" :title="t('ide.explorer.newFolder')" :aria-pressed="inlineRowVisible && createKind === 'folder'" @click="startCreatingFolder">
          <FolderPlus :size="15" aria-hidden="true" />
        </button>
        <button type="button" data-action="ide-refresh-tree" :aria-label="t('ide.explorer.refresh')" :title="t('ide.explorer.refresh')" :disabled="busy" @click="emit('refresh')">
          <RefreshCw :size="15" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="ide-explorer__collapse"
          data-action="ide-collapse-folders"
          :data-collapsed="allCollapsed ? 'true' : 'false'"
          :aria-pressed="allCollapsed"
          :aria-label="t('ide.explorer.collapseFolders')"
          :title="t('ide.explorer.collapseFolders')"
          :disabled="!directoryPaths.length"
          @click="collapseAll"
        >
          <ListCollapse :size="15" aria-hidden="true" />
        </button>
      </span>
    </header>

    <p v-if="error" class="ide-explorer__error" role="alert">{{ error }}</p>
    <p v-if="!rows.length && !inlineRowVisible" class="empty-state ide-explorer__empty">{{ t('ide.explorer.empty') }}</p>
    <ul v-else class="ide-tree" role="tree" :aria-label="t('ide.explorer.tree')">
      <li
        v-for="row in displayRows"
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
            <FileIcon kind="folder" :name="row.node.name" :expanded="!isCollapsed(row.node.path)" :theme="iconTheme" :size="15" />
            <span class="ide-tree__name">{{ row.node.name }}</span>
          </button>
        </div>
        <!-- The creation row takes its place in the tree so a new file or
             folder lands where the selection is, not at the panel top. -->
        <div
          v-if="row.create"
          class="ide-tree__row ide-tree__row--create"
          data-testid="ide-inline-create"
          :data-parent="createTarget?.parent ?? ''"
          :data-depth="row.depth"
          :data-kind="row.create"
          :style="{ paddingLeft: `${8 + row.depth * 12}px` }"
        >
          <form
            class="ide-tree__create-form"
            :data-testid="row.create === 'file' ? 'ide-new-file-form' : 'ide-new-folder-form'"
            @submit.prevent="submitInlineCreate"
          >
            <FilePlus v-if="row.create === 'file'" :size="14" aria-hidden="true" />
            <FolderPlus v-else :size="14" aria-hidden="true" />
            <input
              v-if="row.create === 'file'"
              :ref="setCreateInput"
              v-model="draftName"
              type="text"
              name="fileName"
              :placeholder="t('ide.explorer.fileNamePlaceholder')"
              :aria-label="t('ide.explorer.fileName')"
              @keydown.escape="closeCreateRow"
            >
            <input
              v-else
              :ref="setCreateInput"
              v-model="draftFolderPath"
              type="text"
              name="folderName"
              :placeholder="t('ide.explorer.folderNamePlaceholder')"
              :aria-label="t('ide.explorer.folderName')"
              @keydown.escape="closeCreateRow"
            >
            <button type="submit" :data-action="row.create === 'file' ? 'ide-create-file' : 'ide-create-folder'" :aria-label="t('ide.explorer.create')">
              <Check :size="14" aria-hidden="true" />
            </button>
            <button
              type="button"
              :data-action="row.create === 'file' ? 'ide-cancel-create' : 'ide-cancel-folder'"
              :aria-label="t('ide.explorer.cancel')"
              @click="closeCreateRow"
            >
              <X :size="14" aria-hidden="true" />
            </button>
          </form>
        </div>
        <div
          v-else-if="row.node.type === 'file'"
          class="ide-tree__row"
          :class="{ 'ide-tree__row--active': activePath === row.node.path }"
          :style="{ paddingLeft: `${8 + row.depth * 12}px` }"
        >
          <button type="button" class="ide-tree__open" :data-action="`ide-open-${row.node.path}`" @click="emit('select', row.node.path)">
            <FileIcon :path="row.node.path" :name="row.node.name" :theme="iconTheme" :size="14" />
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
