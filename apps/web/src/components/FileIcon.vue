<script setup lang="ts">
import { computed } from 'vue';
import { fileIconFor, fileIconGlyph, folderIconFor, folderIconGlyph, type IconTheme } from '../editor/fileIcon';

const props = withDefaults(defineProps<{
  /** File path or bare name; the extension and name rules both read it. */
  path?: string;
  /** Folder name, used when `kind` is a folder. */
  name?: string;
  kind?: 'file' | 'folder';
  expanded?: boolean;
  theme?: IconTheme;
  size?: number;
}>(), { path: '', name: '', kind: 'file', expanded: false, theme: 'dark', size: 16 });

const label = computed(() => props.name || props.path);
const iconId = computed(() => (props.kind === 'folder'
  ? folderIconFor(props.name, props.expanded, props.theme)
  : fileIconFor(props.path, props.theme)));
const glyph = computed(() => (props.kind === 'folder'
  ? folderIconGlyph(props.name, props.expanded, props.theme)
  : fileIconGlyph(props.path, props.theme)));
// Isolate each SVG document so repeated icons cannot collide through SVG ids.
const source = computed(() => `data:image/svg+xml,${encodeURIComponent(glyph.value)}`);
</script>

<template>
  <span
    class="file-icon"
    :data-icon="iconId"
    :data-kind="kind"
    :style="{ '--file-icon-size': `${size}px` }"
    :title="label || undefined"
    aria-hidden="true"
  >
    <img :src="source" alt="" draggable="false" />
  </span>
</template>
