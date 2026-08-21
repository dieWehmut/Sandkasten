<script setup lang="ts">
import { Clock3 } from '@lucide/vue';
import type { DeepReadonly } from 'vue';
import type { RunHistoryItem } from '../composables/useRunHistory';
import { statusLabel } from '../state/status';

defineProps<{ item: DeepReadonly<RunHistoryItem>; selected?: boolean }>();
const emit = defineEmits<{ select: [] }>();

function completedTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function durationLabel(duration: number | undefined): string {
  if (duration === undefined) return 'No duration';
  return duration < 1000 ? `${duration} ms` : `${(duration / 1000).toFixed(2)} s`;
}
</script>

<template>
  <button
    type="button"
    class="history-item"
    data-testid="history-item"
    :aria-current="selected ? 'true' : undefined"
    @click="emit('select')"
  >
    <span class="history-item__primary">
      <strong>{{ item.language }}</strong>
      <span>{{ statusLabel(item.status) }}</span>
    </span>
    <span class="history-item__meta">
      <Clock3 :size="13" aria-hidden="true" />
      <span>{{ completedTime(item.completedAt) }}</span>
      <span>{{ durationLabel(item.result.durationMs) }}</span>
    </span>
  </button>
</template>
