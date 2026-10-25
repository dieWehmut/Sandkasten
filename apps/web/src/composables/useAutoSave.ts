import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue';
import type { FileSettings } from '../state/editorSettings';
import type { WorkspaceFile } from './useWorkspace';

export function useAutoSave(options: {
  files: Readonly<Ref<readonly WorkspaceFile[]>>;
  settings: Readonly<Ref<FileSettings>>;
  saveFile(path: string): Promise<boolean>;
}) {
  const scheduled = new Map<string, { source: string; timer: ReturnType<typeof setTimeout> }>();
  const saving = new Map<string, string>();
  function cancel(): void {
    for (const { timer } of scheduled.values()) clearTimeout(timer);
    scheduled.clear();
  }
  function save(path: string, source: string): void {
    if (saving.get(path) === source) return;
    saving.set(path, source);
    void options.saveFile(path).finally(() => { if (saving.get(path) === source) saving.delete(path); });
  }
  function schedule(): void {
    const dirty = options.files.value.filter((file) => file.dirty);
    for (const [path, item] of scheduled) {
      if (!dirty.some((file) => file.path === path && file.source === item.source)) {
        clearTimeout(item.timer);
        scheduled.delete(path);
      }
    }
    if (options.settings.value.autoSave !== 'afterDelay') return;
    for (const file of dirty) {
      if (scheduled.has(file.path) || saving.get(file.path) === file.source) continue;
      const path = file.path;
      const source = file.source;
      const timer = setTimeout(() => {
        scheduled.delete(path);
        // A tab switch must never save a different active file.
        const current = options.files.value.find((entry) => entry.path === path);
        if (current?.dirty && current.source === source) save(path, source);
      }, options.settings.value.autoSaveDelay);
      scheduled.set(path, { source, timer });
    }
  }
  function saveDirtyOnFocusChange(): void {
    if (options.settings.value.autoSave !== 'onFocusChange') return;
    for (const file of options.files.value) if (file.dirty) save(file.path, file.source);
  }
  function onFocusOut(event: FocusEvent): void {
    const from = event.target instanceof Element ? event.target.closest('.source-editor') : null;
    const to = event.relatedTarget instanceof Element ? event.relatedTarget.closest('.source-editor') : null;
    if (from && from !== to) saveDirtyOnFocusChange();
  }
  watch(() => options.files.value.map(({ path, source, dirty }) => ({ path, source, dirty })), schedule, { deep: true });
  watch(() => [options.settings.value.autoSave, options.settings.value.autoSaveDelay], () => { cancel(); schedule(); }, { immediate: true });
  onMounted(() => {
    document.addEventListener('focusout', onFocusOut);
    window.addEventListener('blur', saveDirtyOnFocusChange);
  });
  onBeforeUnmount(() => {
    cancel();
    document.removeEventListener('focusout', onFocusOut);
    window.removeEventListener('blur', saveDirtyOnFocusChange);
  });
}
