<script setup lang="ts">
import type { DeepReadonly } from 'vue';
import type { RunHistoryItem as HistoryItem } from '../composables/useRunHistory';
import RunHistoryItem from './RunHistoryItem.vue';
import { useTranslation } from '../i18n/useTranslation';

const props = withDefaults(defineProps<{
  items: readonly DeepReadonly<HistoryItem>[];
  selectedJobId?: string;
  hideHeading?: boolean;
}>(), { hideHeading: false });
const emit = defineEmits<{ select: [item: DeepReadonly<HistoryItem>] }>();
const t = useTranslation();
</script>

<template>
  <aside
    id="history-panel"
    class="run-history"
    :aria-labelledby="props.hideHeading ? undefined : 'history-title'"
    :aria-label="props.hideHeading ? t('history.title') : undefined"
  >
    <header v-if="!props.hideHeading" class="pane-heading">
      <p class="eyebrow">{{ t('workbench.session') }}</p>
      <h2 id="history-title">{{ t('history.title') }}</h2>
    </header>
    <p v-if="!items.length" class="empty-state">{{ t('history.empty') }}</p>
    <div v-else class="history-list">
      <RunHistoryItem
        v-for="item in items"
        :key="`${item.jobId}-${item.completedAt}`"
        :item="item"
        :selected="selectedJobId === item.jobId"
        @select="emit('select', item)"
      />
    </div>
  </aside>
</template>
