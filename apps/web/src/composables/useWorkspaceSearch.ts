// One search at a time over the opened folder. The controller owns the query,
// the case toggle, and the last result set so the view stays presentational.
import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { searchWorkspace, type WorkspaceSearchFile } from '../services/workspaceSearch';

export type WorkspaceSearchState = 'idle' | 'searching' | 'ready' | 'empty' | 'error';

export interface WorkspaceSearchController {
  state: Ref<WorkspaceSearchState>;
  query: Ref<string>;
  caseSensitive: Ref<boolean>;
  results: Ref<WorkspaceSearchFile[]>;
  fileCount: Ref<number>;
  matchCount: Ref<number>;
  truncated: Ref<boolean>;
  error: Ref<string | undefined>;
  summary: ComputedRef<string>;
  run(query?: string, caseSensitive?: boolean): Promise<void>;
  clear(): void;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useWorkspaceSearch(): WorkspaceSearchController {
  const state = ref<WorkspaceSearchState>('idle');
  const query = ref('');
  const caseSensitive = ref(false);
  const results = ref<WorkspaceSearchFile[]>([]);
  const fileCount = ref(0);
  const matchCount = ref(0);
  const truncated = ref(false);
  const error = ref<string>();
  // A generation counter keeps a slow answer for an older query from replacing
  // the results of the query the user typed afterwards.
  let generation = 0;

  const summary = computed(() => {
    if (state.value !== 'ready') return '';
    const files = `${fileCount.value} ${fileCount.value === 1 ? 'file' : 'files'}`;
    const matches = `${matchCount.value} ${matchCount.value === 1 ? 'result' : 'results'}`;
    return `${matches} in ${files}`;
  });

  async function run(next = query.value, sensitivity = caseSensitive.value): Promise<void> {
    query.value = next;
    caseSensitive.value = sensitivity;
    if (!next.trim()) {
      state.value = 'idle';
      results.value = [];
      fileCount.value = 0;
      matchCount.value = 0;
      truncated.value = false;
      error.value = undefined;
      return;
    }
    const current = ++generation;
    state.value = 'searching';
    error.value = undefined;
    try {
      const result = await searchWorkspace(next, sensitivity);
      if (current !== generation) return;
      results.value = result.files;
      fileCount.value = result.fileCount;
      matchCount.value = result.matchCount;
      truncated.value = result.truncated;
      state.value = result.fileCount ? 'ready' : 'empty';
    } catch (cause) {
      if (current !== generation) return;
      results.value = [];
      fileCount.value = 0;
      matchCount.value = 0;
      truncated.value = false;
      error.value = messageFrom(cause);
      state.value = 'error';
    }
  }

  function clear(): void {
    generation += 1;
    query.value = '';
    state.value = 'idle';
    results.value = [];
    fileCount.value = 0;
    matchCount.value = 0;
    truncated.value = false;
    error.value = undefined;
  }

  return { state, query, caseSensitive, results, fileCount, matchCount, truncated, error, summary, run, clear };
}
