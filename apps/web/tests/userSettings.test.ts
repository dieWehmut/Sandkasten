import { beforeEach, expect, test, vi } from 'vitest';
import { useUserSettings, USER_SETTINGS_STORAGE_KEY } from '../src/composables/useUserSettings';
import { normalizeUserSettings } from '../src/state/editorSettings';

beforeEach(() => localStorage.clear());

test('settings survive a fresh controller and invalid stored values use usable defaults', () => {
  const settings = useUserSettings();
  settings.setEditor('fontSize', 19);
  settings.setEditor('wordWrap', true);
  settings.setFiles('autoSave', 'afterDelay');
  settings.setFiles('autoSaveDelay', 600);
  settings.setWorkbench('panelVisible', false);
  expect(useUserSettings().settings.value).toMatchObject({ editor: { fontSize: 19, wordWrap: true }, files: { autoSave: 'afterDelay', autoSaveDelay: 600 }, workbench: { panelVisible: false } });
  localStorage.setItem(USER_SETTINGS_STORAGE_KEY, JSON.stringify({ editor: { fontSize: -2, tabSize: 99, wordWrap: 'yes' }, files: { autoSave: 'unknown', autoSaveDelay: 5 } }));
  expect(useUserSettings().settings.value).toEqual(normalizeUserSettings());
});

test('a storage failure does not prevent an effective session preference', () => {
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  try {
    const settings = useUserSettings();
    settings.setEditor('quickSuggestions', false);
    expect(settings.settings.value.editor.quickSuggestions).toBe(false);
  } finally { write.mockRestore(); }
});
