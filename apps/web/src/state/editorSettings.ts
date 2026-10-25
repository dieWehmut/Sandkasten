export interface EditorSettings {
  fontSize: number;
  tabSize: number;
  insertSpaces: boolean;
  wordWrap: boolean;
  lineNumbers: boolean;
  minimap: boolean;
  indentGuides: boolean;
  quickSuggestions: boolean;
}

export const DEFAULT_EDITOR_SETTINGS: Readonly<EditorSettings> = Object.freeze({
  fontSize: 14,
  tabSize: 4,
  insertSpaces: true,
  wordWrap: false,
  lineNumbers: true,
  minimap: true,
  indentGuides: true,
  quickSuggestions: true,
});

export type AutoSaveMode = 'off' | 'afterDelay' | 'onFocusChange';
export interface FileSettings { autoSave: AutoSaveMode; autoSaveDelay: number }
export interface WorkbenchSettings { sidebarVisible: boolean; panelVisible: boolean }
export interface UserSettings {
  editor: EditorSettings;
  files: FileSettings;
  workbench: WorkbenchSettings;
}

export const DEFAULT_FILE_SETTINGS: Readonly<FileSettings> = Object.freeze({ autoSave: 'off', autoSaveDelay: 1000 });
export const DEFAULT_WORKBENCH_SETTINGS: Readonly<WorkbenchSettings> = Object.freeze({ sidebarVisible: true, panelVisible: true });

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

// Persisted input is untrusted: a stale or hand-edited preference must never
// prevent the workbench from starting or configure an unusable editor.
export function normalizeUserSettings(value?: unknown): UserSettings {
  const saved = object(value);
  const editor = object(saved.editor);
  const files = object(saved.files);
  const workbench = object(saved.workbench);
  const normalized = { ...DEFAULT_EDITOR_SETTINGS };
  for (const key of ['insertSpaces', 'wordWrap', 'lineNumbers', 'minimap', 'indentGuides', 'quickSuggestions'] as const) {
    if (typeof editor[key] === 'boolean') normalized[key] = editor[key];
  }
  normalized.fontSize = boundedInteger(editor.fontSize, DEFAULT_EDITOR_SETTINGS.fontSize, 10, 32);
  normalized.tabSize = boundedInteger(editor.tabSize, DEFAULT_EDITOR_SETTINGS.tabSize, 1, 8);
  return {
    editor: normalized,
    files: {
      autoSave: files.autoSave === 'afterDelay' || files.autoSave === 'onFocusChange' ? files.autoSave : 'off',
      autoSaveDelay: boundedInteger(files.autoSaveDelay, DEFAULT_FILE_SETTINGS.autoSaveDelay, 100, 10000),
    },
    workbench: {
      sidebarVisible: typeof workbench.sidebarVisible === 'boolean' ? workbench.sidebarVisible : true,
      panelVisible: typeof workbench.panelVisible === 'boolean' ? workbench.panelVisible : true,
    },
  };
}
