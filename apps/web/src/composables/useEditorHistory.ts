import { computed, readonly, ref, watch, type Ref } from 'vue';

/** File navigation is independent of tabs: a closed editor can still be revisited. */
export function useEditorHistory(options: {
  activePath: Readonly<Ref<string>>;
  paths: Readonly<Ref<readonly string[]>>;
  openFile(path: string): Promise<void>;
  limit?: number;
}) {
  const limit = Math.max(2, options.limit ?? 50);
  const entries = ref<string[]>([]);
  const index = ref(-1);
  const recentPaths = ref<string[]>([]);
  const pending = ref(false);
  let target: string | undefined;

  function reset(): void {
    entries.value = [];
    recentPaths.value = [];
    index.value = -1;
  }

  watch(options.activePath, (path) => {
    if (!path) return;
    recentPaths.value = [path, ...recentPaths.value.filter((entry) => entry !== path)].slice(0, limit);
    if (path === target || entries.value[index.value] === path) return;
    entries.value = [...entries.value.slice(0, index.value + 1), path].slice(-limit);
    index.value = entries.value.length - 1;
  }, { immediate: true, flush: 'sync' });

  watch(options.paths, (paths) => {
    const valid = new Set(paths);
    const before = entries.value.slice(0, index.value + 1).filter((path) => valid.has(path));
    entries.value = entries.value.filter((path) => valid.has(path));
    index.value = before.length - 1;
    recentPaths.value = recentPaths.value.filter((path) => valid.has(path));
  }, { flush: 'sync' });

  const canBack = computed(() => !pending.value && index.value > 0);
  const canForward = computed(() => !pending.value && index.value < entries.value.length - 1);

  async function navigate(delta: -1 | 1): Promise<void> {
    if (pending.value || (delta === -1 ? !canBack.value : !canForward.value)) return;
    const nextIndex = index.value + delta;
    target = entries.value[nextIndex];
    pending.value = true;
    try {
      await options.openFile(target);
      index.value = nextIndex;
    } finally {
      pending.value = false;
      target = undefined;
    }
  }

  return { canBack, canForward, recentPaths: readonly(recentPaths), reset,
    back: () => navigate(-1), forward: () => navigate(1) };
}
