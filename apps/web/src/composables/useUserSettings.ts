import { readonly, ref } from 'vue';
import { normalizeUserSettings, type EditorSettings, type FileSettings, type WorkbenchSettings } from '../state/editorSettings';

export const USER_SETTINGS_STORAGE_KEY = 'sandkasten-user-settings-v1';

export function useUserSettings() {
  let stored: unknown;
  try { stored = JSON.parse(localStorage.getItem(USER_SETTINGS_STORAGE_KEY) ?? 'null'); } catch { /* Defaults also work when storage is blocked. */ }
  const settings = ref(normalizeUserSettings(stored));
  function replace(value: unknown): void {
    settings.value = normalizeUserSettings(value);
    try { localStorage.setItem(USER_SETTINGS_STORAGE_KEY, JSON.stringify(settings.value)); } catch { /* Changes still apply for this session. */ }
  }
  function setEditor<K extends keyof EditorSettings>(key: K, value: EditorSettings[K]): void {
    replace({ ...settings.value, editor: { ...settings.value.editor, [key]: value } });
  }
  function setFiles<K extends keyof FileSettings>(key: K, value: FileSettings[K]): void {
    replace({ ...settings.value, files: { ...settings.value.files, [key]: value } });
  }
  function setWorkbench<K extends keyof WorkbenchSettings>(key: K, value: WorkbenchSettings[K]): void {
    replace({ ...settings.value, workbench: { ...settings.value.workbench, [key]: value } });
  }
  return { settings: readonly(settings), setEditor, setFiles, setWorkbench };
}
