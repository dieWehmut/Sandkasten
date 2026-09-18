<script setup lang="ts">
import { computed } from 'vue';
import {
  Braces, FileCode, FileJson, FileTerminal, FileText, Hash, Palette, WholeWord,
  type Component,
} from '@lucide/vue';
import { fileVisualFor, type FileIconShape } from '../editor/fileIcon';

const props = withDefaults(defineProps<{
  language?: string;
  name?: string;
  size?: number;
}>(), { language: '', name: '', size: 14 });

// One glyph per shape keeps the tree and the tab strip visually aligned: the
// hue tells the language family apart, the silhouette tells the file kind.
const SHAPE_ICONS: Readonly<Record<FileIconShape, Component>> = {
  code: FileCode,
  braces: Braces,
  json: FileJson,
  text: FileText,
  terminal: FileTerminal,
  markup: Hash,
  style: Palette,
  data: WholeWord,
};

const visual = computed(() => fileVisualFor(props.language));
const icon = computed(() => SHAPE_ICONS[visual.value.shape]);
const label = computed(() => props.name || props.language);
</script>

<template>
  <span class="file-icon" :data-tone="visual.tone" :data-shape="visual.shape" :title="label || undefined">
    <component :is="icon" :size="size" aria-hidden="true" />
  </span>
</template>
