<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { X } from '@lucide/vue';
import type { IconTheme } from '../../editor/fileIcon';
import { useTranslation } from '../../i18n/useTranslation';
import FileIcon from '../FileIcon.vue';

const props = defineProps<{
  files: ReadonlyArray<{ path: string; name: string; dirty: boolean }>;
  activePath: string;
  iconTheme?: IconTheme;
}>();
const emit = defineEmits<{ select: [path: string]; close: [path: string] }>();
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
</script>

<template>
  <div ref="strip" class="ide-tabs" role="tablist" :aria-label="t('ide.tabs.label')" data-testid="editor-tabs">
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
  </div>
</template>
