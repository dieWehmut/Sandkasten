import { DEFAULT_RENDER_WHITESPACE, isRenderWhitespaceMode, type RenderWhitespaceMode } from '../editor/renderWhitespace';

export interface EditorSettings {
  fontSize: number;
  tabSize: number;
  insertSpaces: boolean;
  wordWrap: boolean;
  lineNumbers: boolean;
  minimap: boolean;
  indentGuides: boolean;
  quickSuggestions: boolean;
  /** `editor.stickyScroll.enabled`, which defaults to on in the reference. */
  stickyScroll: boolean;
  /** `editor.bracketPairColorization.enabled`, also on by default. */
  bracketPairColorization: boolean;
  /** `editor.scrollBeyondLastLine`, also on by default in the reference. */
  scrollBeyondLastLine: boolean;
  /** `editor.renderWhitespace`, which defaults to `selection`. */
  renderWhitespace: RenderWhitespaceMode;
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
  stickyScroll: true,
  bracketPairColorization: true,
  scrollBeyondLastLine: true,
  renderWhitespace: DEFAULT_RENDER_WHITESPACE,
});

export type AutoSaveMode = 'off' | 'afterDelay' | 'onFocusChange';
export interface FileSettings { autoSave: AutoSaveMode; autoSaveDelay: number }
// The two pane sizes are the reference's `sideBar.size` and `panel.size`: the
// workbench remembers them across sessions, so they belong with the other
// persisted workbench preferences rather than in component state.
export interface WorkbenchSettings {
  sidebarVisible: boolean;
  panelVisible: boolean;
  sidebarWidth: number;
  panelHeight: number;
  /** Mirrors the reference's `explorer.excludeGitIgnore`, whose default is false. */
  excludeGitIgnore: boolean;
}
export interface UserSettings {
  editor: EditorSettings;
  files: FileSettings;
  workbench: WorkbenchSettings;
}

export const DEFAULT_FILE_SETTINGS: Readonly<FileSettings> = Object.freeze({ autoSave: 'off', autoSaveDelay: 1000 });

// Measured from the reference: the side bar's `sideBar.size` default is 300 px
// with a 170 px floor, and the panel's `panel.size` default is 300 px. The
// ceilings keep a drag from swallowing the editor on a small window; the CSS
// clamps them further against the viewport.
export const SIDEBAR_DEFAULT_WIDTH = 300;
export const SIDEBAR_MIN_WIDTH = 170;
export const SIDEBAR_MAX_WIDTH = 720;
export const PANEL_DEFAULT_HEIGHT = 300;
export const PANEL_MIN_HEIGHT = 100;
export const PANEL_MAX_HEIGHT = 1200;

export const DEFAULT_WORKBENCH_SETTINGS: Readonly<WorkbenchSettings> = Object.freeze({
  sidebarVisible: true,
  panelVisible: true,
  sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
  panelHeight: PANEL_DEFAULT_HEIGHT,
  // `"explorer.excludeGitIgnore": { type: "boolean", default: false }` — ignored
  // entries stay in the tree and are tinted; turning this on hides them.
  excludeGitIgnore: false,
});

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
  for (const key of ['insertSpaces', 'wordWrap', 'lineNumbers', 'minimap', 'indentGuides', 'quickSuggestions', 'stickyScroll', 'bracketPairColorization', 'scrollBeyondLastLine'] as const) {
    if (typeof editor[key] === 'boolean') normalized[key] = editor[key];
  }
  normalized.fontSize = boundedInteger(editor.fontSize, DEFAULT_EDITOR_SETTINGS.fontSize, 10, 32);
  normalized.tabSize = boundedInteger(editor.tabSize, DEFAULT_EDITOR_SETTINGS.tabSize, 1, 8);
  // An unknown mode falls back to the reference's default rather than an invalid one.
  if (isRenderWhitespaceMode(editor.renderWhitespace)) normalized.renderWhitespace = editor.renderWhitespace;
  return {
    editor: normalized,
    files: {
      autoSave: files.autoSave === 'afterDelay' || files.autoSave === 'onFocusChange' ? files.autoSave : 'off',
      autoSaveDelay: boundedInteger(files.autoSaveDelay, DEFAULT_FILE_SETTINGS.autoSaveDelay, 100, 10000),
    },
    workbench: {
      sidebarVisible: typeof workbench.sidebarVisible === 'boolean' ? workbench.sidebarVisible : true,
      panelVisible: typeof workbench.panelVisible === 'boolean' ? workbench.panelVisible : true,
      sidebarWidth: boundedInteger(workbench.sidebarWidth, DEFAULT_WORKBENCH_SETTINGS.sidebarWidth, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH),
      panelHeight: boundedInteger(workbench.panelHeight, DEFAULT_WORKBENCH_SETTINGS.panelHeight, PANEL_MIN_HEIGHT, PANEL_MAX_HEIGHT),
      excludeGitIgnore: typeof workbench.excludeGitIgnore === 'boolean'
        ? workbench.excludeGitIgnore
        : DEFAULT_WORKBENCH_SETTINGS.excludeGitIgnore,
    },
  };
}
