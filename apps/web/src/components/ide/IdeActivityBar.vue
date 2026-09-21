<script setup lang="ts">
import { Settings, Clock, Files, Info, Search, Monitor } from '@lucide/vue';
import type { Component } from 'vue';
import type { IdeActivity } from '../../composables/useIdeLayout';
import { useTranslation } from '../../i18n/useTranslation';

defineProps<{ active: IdeActivity; sidebarVisible: boolean }>();
const emit = defineEmits<{ select: [activity: IdeActivity]; openSettings: [] }>();
const t = useTranslation();

const items: Array<{ id: IdeActivity; labelKey: Parameters<typeof t>[0]; icon: Component }> = [
  { id: 'explorer', labelKey: 'ide.activity.explorer', icon: Files },
  { id: 'search', labelKey: 'ide.activity.search', icon: Search },
  { id: 'remote', labelKey: 'ide.activity.remote', icon: Monitor },
  { id: 'runs', labelKey: 'ide.activity.runs', icon: Clock },
  { id: 'context', labelKey: 'ide.activity.context', icon: Info },
];
</script>

<template>
  <nav class="ide-activity" :aria-label="t('ide.activity.label')" data-testid="ide-activity-bar">
    <button
      v-for="item in items"
      :key="item.id"
      type="button"
      class="ide-activity__button"
      :data-activity="item.id"
      :aria-label="t(item.labelKey)"
      :title="t(item.labelKey)"
      :aria-pressed="active === item.id && sidebarVisible"
      @click="emit('select', item.id)"
    >
      <component :is="item.icon" :size="19" aria-hidden="true" />
    </button>
    <button
      type="button"
      class="ide-activity__button ide-activity__button--footer"
      data-action="open-settings"
      :aria-label="t('settings.title')"
      :title="t('settings.title')"
      @click="emit('openSettings')"
    >
      <Settings :size="19" aria-hidden="true" />
    </button>
  </nav>
</template>
