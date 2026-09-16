import { readonly, ref, type DeepReadonly, type Ref } from 'vue';
import type { JobResponse } from '../services/sandkastenApi';

export interface RunHistoryItem {
  source: string;
  language: string;
  jobId: string;
  startedAt: string;
  completedAt: string;
  status: string;
  result: JobResponse;
}

export interface RunHistory {
  history: DeepReadonly<Ref<RunHistoryItem[]>>;
  add(item: RunHistoryItem): void;
  clear(): void;
}

export function useRunHistory(limit = 20): RunHistory {
  const items = ref<RunHistoryItem[]>([]);

  function add(item: RunHistoryItem) {
    items.value = [item, ...items.value].slice(0, limit);
  }

  function clear() {
    items.value = [];
  }

  return { history: readonly(items), add, clear };
}
