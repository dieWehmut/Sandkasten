import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_EDITOR_SETTINGS, normalizeUserSettings } from '../src/state/editorSettings';
import { USER_SETTINGS_STORAGE_KEY } from '../src/composables/useUserSettings';

// Every row the settings panel offers has to reach something. A switch that persists a
// value nothing reads looks exactly like a working switch in a screenshot, and this
// codebase has already shipped one feature — Zen mode — that was written, tested and
// never called. So the check here is deliberately textual: it walks the rows the panel
// declares and asserts each key is read somewhere outside the panel and its schema.

const settingsView = readFileSync(resolve(process.cwd(), 'src/components/SettingsView.vue'), 'utf8');

/** `row('editor', 'fontSize', ...)` → `{ group: 'editor', key: 'fontSize' }`. */
const declaredRows = [...settingsView.matchAll(/row\('(\w+)',\s*'(\w+)'/g)]
  .map((m) => ({ group: m[1], key: m[2] }));

const sources = ['components/SourceEditor.vue', 'components/WorkbenchShell.vue', 'App.vue', 'composables/useAutoSave.ts', 'composables/useWorkspace.ts']
  .map((path) => ({ path, text: readFileSync(resolve(process.cwd(), 'src', path), 'utf8') }));

describe('settings panel wiring', () => {
  test('declares the editor rows the design calls for', () => {
    // Guards the extraction itself: if the `row(...)` shape changes, this fails loudly
    // rather than silently reporting zero rows and passing the checks below.
    expect(declaredRows.length).toBeGreaterThanOrEqual(17);
    expect(declaredRows.map((r) => `${r.group}.${r.key}`)).toContain('editor.minimap');
    expect(declaredRows.map((r) => `${r.group}.${r.key}`)).toContain('files.autoSave');
  });

  test('every row is read by something other than the panel', () => {
    const unread = [];
    for (const { group, key } of declaredRows) {
      const readSomewhere = sources.some(({ text }) => new RegExp(`\\.${key}\\b`).test(text));
      if (!readSomewhere) unread.push(`${group}.${key}`);
    }
    // The failure this catches is a row wired to the store and to nothing else: the
    // toggle moves, the value persists, and the editor never changes.
    expect(unread).toEqual([]);
  });

  test('the editor defaults match the reference', () => {
    // Measured from the reference build and recorded in the fidelity plan:
    // `editor.wordWrap` is `"off"`, `editor.lineNumbers` is `"on"`,
    // `editor.minimap.enabled` is true, `editor.renderWhitespace` is `"selection"`,
    // `editor.scrollBeyondLastLine`, `editor.stickyScroll.enabled` and
    // `editor.bracketPairColorization.enabled` are all on, and the text-model block is
    // `{tabSize: 4, indentSize: 4, insertSpaces: true}`.
    expect(DEFAULT_EDITOR_SETTINGS).toMatchObject({
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
      renderWhitespace: 'selection',
    });
  });

  test('stored settings survive a round trip', () => {
    // The panel writes through `normalizeUserSettings`, so a stored value that the
    // normalizer drops is a setting that silently resets on reload.
    const stored = {
      editor: { ...DEFAULT_EDITOR_SETTINGS, minimap: false, fontSize: 20, tabSize: 8 },
      files: { autoSave: 'afterDelay', autoSaveDelay: 500 },
      workbench: { sidebarVisible: false, panelVisible: false, sidebarWidth: 400, panelHeight: 200, excludeGitIgnore: true },
    };
    const restored = normalizeUserSettings(JSON.parse(JSON.stringify(stored)));
    expect(restored.editor.minimap).toBe(false);
    expect(restored.editor.fontSize).toBe(20);
    expect(restored.editor.tabSize).toBe(8);
    expect(restored.files.autoSave).toBe('afterDelay');
    expect(restored.files.autoSaveDelay).toBe(500);
    expect(restored.workbench.sidebarVisible).toBe(false);
    expect(restored.workbench.excludeGitIgnore).toBe(true);
  });

  test('nonsense in storage falls back instead of breaking the editor', () => {
    // `localStorage` is shared with anything else on the origin, and the normalizer is
    // the only thing standing between a bad value and CodeMirror's configuration.
    for (const bad of [null, undefined, 42, 'nope', [], { editor: 'no' }]) {
      const restored = normalizeUserSettings(bad);
      expect(restored.editor.tabSize).toBe(DEFAULT_EDITOR_SETTINGS.tabSize);
      expect(restored.editor.fontSize).toBe(DEFAULT_EDITOR_SETTINGS.fontSize);
    }
    // Out-of-range numbers are clamped rather than trusted.
    expect(normalizeUserSettings({ editor: { tabSize: 999, fontSize: 1 } }).editor.tabSize).toBeLessThanOrEqual(8);
    expect(normalizeUserSettings({ editor: { tabSize: 999, fontSize: 1 } }).editor.fontSize).toBeGreaterThanOrEqual(10);
  });

  test('the storage key is versioned', () => {
    // The `-v1` suffix is what allows `normalizeUserSettings` to be changed later
    // without silently reinterpreting everyone's stored shape.
    expect(USER_SETTINGS_STORAGE_KEY).toBe('sandkasten-user-settings-v1');
  });
});
