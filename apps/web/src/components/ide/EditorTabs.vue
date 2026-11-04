<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { X } from '@lucide/vue';
import type { IconTheme } from '../../editor/fileIcon';
import type { ContextMenuEntry } from '../contextMenu';
import { tabMenuEntries, planTabClose, type TabMenuAction } from '../../editor/tabMenu';
import { useTranslation } from '../../i18n/useTranslation';
import FileIcon from '../FileIcon.vue';
import ContextMenu from '../ContextMenu.vue';

const props = defineProps<{
  files: ReadonlyArray<{ path: string; name: string; dirty: boolean }>;
  activePath: string;
  iconTheme?: IconTheme;
}>();
const emit = defineEmits<{
  select: [path: string];
  close: [path: string];
  /** A bulk close; the shell decides which of these need the discard prompt. */
  closeMany: [paths: string[]];
  copyPath: [path: string];
  reveal: [path: string];
  /** A dragged tab asking for a new position in the strip. */
  move: [payload: { from: string; toIndex: number }];
}>();
const t = useTranslation();

// The strip scrolls sideways once the tabs outrun it, so opening a file from
// anywhere but the strip itself — the explorer, quick open, a breadcrumb — would
// otherwise leave its tab off-screen behind the ones already there.
const strip = ref<HTMLElement | null>(null);
watch(() => props.activePath, async () => {
  await nextTick();
  const active = strip.value?.querySelector<HTMLElement>('.ide-tab--active');
  active?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}, { immediate: true });

// The reference's tab context menu: Close / Close Others / Close to the Right /
// Close Saved / Close All, then Pin, then the file actions. Right-clicking a tab
// also makes it the active one, which is what the reference does before showing
// the menu so the commands act on the tab under the pointer.
const menuOpen = ref(false);
const menuAt = ref({ x: 0, y: 0 });
const menuEntries = ref<ContextMenuEntry[]>([]);
const menuPath = ref('');

const paths = computed(() => props.files.map((file) => file.path));

function openTabMenu(path: string, event: MouseEvent): void {
  const index = paths.value.indexOf(path);
  if (index === -1) return;
  // The reference makes the right-clicked tab active before showing the menu, so
  // the commands act on the tab under the pointer.
  if (path !== props.activePath) emit('select', path);
  menuEntries.value = tabMenuEntries(t, {
    index,
    total: props.files.length,
    dirtyCount: props.files.filter((entry) => entry.dirty).length,
  });
  menuPath.value = path;
  menuAt.value = { x: event.clientX, y: event.clientY };
  menuOpen.value = true;
}

function runTabMenuAction(id: string): void {
  menuOpen.value = false;
  const path = menuPath.value;
  if (!path) return;
  if (id === 'copyPath') { emit('copyPath', path); return; }
  if (id === 'reveal') { emit('reveal', path); return; }
  // The strip computes the targets and the shell applies them, so a dirty buffer
  // still goes through the discard prompt instead of disappearing silently.
  const plan = planTabClose(id as TabMenuAction, paths.value, path, props.files.filter((file) => file.dirty).map((file) => file.path));
  if (!plan) return;
  const targets = [...plan.close, ...plan.ask];
  if (targets.length) emit('closeMany', targets);
}

function closeTabMenu(): void {
  menuOpen.value = false;
}

// Dragging a tab reorders the strip, as the reference allows. The drop position is
// the gap between two tabs: the pointer's half of the hovered tab decides whether
// the source lands before or after it, and the strip draws the reference's 2 px
// `tab-dragAndDropBorder` line at that gap.
const dragFrom = ref('');
const dropIndex = ref(-1);

function onDragStart(path: string, event: DragEvent): void {
  dragFrom.value = path;
  dropIndex.value = paths.value.indexOf(path);
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    // Firefox refuses to start a drag without a payload.
    event.dataTransfer.setData('text/plain', path);
  }
}

function onDragOver(index: number, event: DragEvent): void {
  if (!dragFrom.value) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  dropIndex.value = event.clientX < box.left + box.width / 2 ? index : index + 1;
}

function onDrop(event: DragEvent): void {
  event.preventDefault();
  const from = dragFrom.value;
  const fromIndex = paths.value.indexOf(from);
  // Removing the source shifts every later tab down one, so a gap to its right
  // maps to one index lower.
  const gap = dropIndex.value > fromIndex ? dropIndex.value - 1 : dropIndex.value;
  if (fromIndex !== -1 && gap >= 0 && gap !== fromIndex) emit('move', { from, toIndex: gap });
  resetDrag();
}

function resetDrag(): void {
  dragFrom.value = '';
  dropIndex.value = -1;
}

function dropClass(index: number): Record<string, boolean> {
  return {
    'ide-tab--dragging': dragFrom.value === paths.value[index],
    'ide-tab--drop-before': dropIndex.value === index,
    'ide-tab--drop-after': dropIndex.value === index + 1,
  };
}

// The reference closes a tab on a middle click: `onMouseMiddleClick` calls
// `closeEditor(editor, { preserveFocus: true })`. `auxclick` also fires for the
// right button, so only button 1 counts, and `preventDefault` stops the browser's
// middle-click autoscroll. A background tab closes without becoming active —
// `closeFile` only moves the active path when the closed tab was the active one.
function middleClose(path: string, event: MouseEvent): void {
  if (event.button !== 1) return;
  event.preventDefault();
  emit('close', path);
}
</script>

<template>
  <div ref="strip" class="ide-tabs" role="tablist" :aria-label="t('ide.tabs.label')" data-testid="editor-tabs">
    <p v-if="!files.length" class="ide-tabs__empty">{{ t('ide.tabs.empty') }}</p>
    <div
      v-for="(file, index) in files"
      :key="file.path"
      class="ide-tab"
      :class="[{ 'ide-tab--active': file.path === activePath }, dropClass(index)]"
      draggable="true"
      @contextmenu.prevent="openTabMenu(file.path, $event)"
      @auxclick="middleClose(file.path, $event)"
      @dragstart="onDragStart(file.path, $event)"
      @dragover="onDragOver(index, $event)"
      @drop="onDrop"
      @dragend="resetDrag"
    >
      <button
        type="button"
        role="tab"
        class="ide-tab__select"
        :data-action="`ide-tab-${file.path}`"
        :aria-selected="file.path === activePath"
        :aria-label="file.dirty ? `${file.name} — ${t('ide.tabs.unsaved')}` : undefined"
        :title="file.path"
        @click="emit('select', file.path)"
      >
        <FileIcon :path="file.path" :name="file.name" :theme="iconTheme" :size="15" />
        <span class="ide-tab__name">{{ file.name }}</span>
      </button>
      <button
        type="button"
        class="ide-tab__close"
        :class="{ 'ide-tab__close--dirty': file.dirty }"
        :data-action="`ide-close-${file.path}`"
        :aria-label="t('ide.tabs.close')"
        :title="file.dirty ? `${t('ide.tabs.unsaved')} — ${t('ide.tabs.close')}` : t('ide.tabs.close')"
        @click="emit('close', file.path)"
      >
        <!-- VS Code paints the filled dot in the close slot while a buffer is
             unsaved and swaps it back to the close glyph on hover. -->
        <span v-if="file.dirty" class="ide-tab__dirty" aria-hidden="true" />
        <X :size="14" aria-hidden="true" />
      </button>
    </div>
    <ContextMenu
      :open="menuOpen"
      :x="menuAt.x"
      :y="menuAt.y"
      :entries="menuEntries"
      :label="t('ide.tabs.menu')"
      @select="runTabMenuAction"
      @close="closeTabMenu"
    />
  </div>
</template>
