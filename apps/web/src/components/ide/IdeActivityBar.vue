<script setup lang="ts">
import { Settings, Clock, Files, GitBranch, Info, Monitor, Moon, Search, Sun } from '@lucide/vue';
import { computed, type Component } from 'vue';
import type { IdeActivity } from '../../composables/useIdeLayout';
import type { Theme } from '../../composables/useTheme';
import { useTranslation } from '../../i18n/useTranslation';

// The bar follows the measured VS Code lane, including the count bubble the
// reference shows on an activity: a 9 px/600 count in a 16 px pill, 24 px down
// and 8 px in from the item's corner. The explorer's badge counts the buffers
// with unsaved changes, the role the reference gives its source-control badge.
const props = withDefaults(defineProps<{
  active: IdeActivity;
  sidebarVisible: boolean;
  badges?: Partial<Record<IdeActivity, number>>;
  /** The theme the page currently paints, so the toggle shows the way out of it. */
  theme?: Theme;
}>(), { theme: 'dark' });
const emit = defineEmits<{ select: [activity: IdeActivity]; openSettings: []; toggleTheme: [] }>();
const t = useTranslation();

const items: Array<{ id: IdeActivity; labelKey: Parameters<typeof t>[0]; icon: Component }> = [
  { id: 'explorer', labelKey: 'ide.activity.explorer', icon: Files },
  { id: 'search', labelKey: 'ide.activity.search', icon: Search },
  { id: 'remote', labelKey: 'ide.activity.remote', icon: Monitor },
  { id: 'source-control', labelKey: 'ide.activity.sourceControl', icon: GitBranch },
  { id: 'runs', labelKey: 'ide.activity.runs', icon: Clock },
  { id: 'context', labelKey: 'ide.activity.context', icon: Info },
];

const badgeFor = (id: IdeActivity): number => Math.max(0, Math.trunc(props.badges?.[id] ?? 0));
const labelFor = (item: { id: IdeActivity; labelKey: Parameters<typeof t>[0] }): string => {
  const label = t(item.labelKey);
  const badge = badgeFor(item.id);
  return badge ? `${label} — ${t('ide.activity.badge').replace('{count}', String(badge))}` : label;
};
// The footer carries the theme toggle directly above settings, so the two app
// wide leaves sit together at the bottom of the lane.
const themeLabel = computed(() => t(props.theme === 'light' ? 'header.theme.useDark' : 'header.theme.useLight'));
</script>

<template>
  <nav class="ide-activity" :aria-label="t('ide.activity.label')" data-testid="ide-activity-bar">
    <button
      v-for="item in items"
      :key="item.id"
      type="button"
      class="ide-activity__button"
      :data-activity="item.id"
      :aria-label="labelFor(item)"
      :title="labelFor(item)"
      :aria-pressed="active === item.id && sidebarVisible"
      @click="emit('select', item.id)"
    >
      <component :is="item.icon" :size="22" aria-hidden="true" />
      <span
        v-if="badgeFor(item.id)"
        class="ide-activity__badge"
        data-testid="activity-badge"
        aria-hidden="true"
      >{{ badgeFor(item.id) }}</span>
    </button>
    <button
      type="button"
      class="ide-activity__button ide-activity__button--footer"
      data-action="toggle-theme"
      :aria-label="themeLabel"
      :title="themeLabel"
      @click="emit('toggleTheme')"
    >
      <Sun v-if="theme === 'dark'" :size="22" aria-hidden="true" />
      <Moon v-else :size="22" aria-hidden="true" />
    </button>
    <button
      type="button"
      class="ide-activity__button"
      data-action="open-settings"
      :aria-label="t('settings.title')"
      :title="t('settings.title')"
      @click="emit('openSettings')"
    >
      <Settings :size="22" aria-hidden="true" />
    </button>
  </nav>
</template>