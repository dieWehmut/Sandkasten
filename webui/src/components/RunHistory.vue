<script setup lang="ts">
import type { DeepReadonly } from 'vue';
import type { RunHistoryItem as HistoryItem } from '../composables/useRunHistory';
import RunHistoryItem from './RunHistoryItem.vue';
import { useTranslation } from '../i18n/useTranslation';

defineProps<{ items: readonly DeepReadonly<HistoryItem>[]; selectedJobId?: string }>();
const emit = defineEmits<{ select: [item: DeepReadonly<HistoryItem>] }>();
const t = useTranslation();
</script>

<template>
  <aside id="history-panel" class="run-history" aria-labelledby="history-title">
    <header class="pane-heading">
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
