import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import SettingsView from '../src/components/SettingsView.vue';
import { createTranslator } from '../src/i18n/locale';
import { DEFAULT_EDITOR_SETTINGS, DEFAULT_FILE_SETTINGS, DEFAULT_WORKBENCH_SETTINGS } from '../src/state/editorSettings';
import type { AppearanceColors } from '../src/composables/useAppearance';

const colors: AppearanceColors = {
  background: '#000000', foreground: '#f1f2f1', accent: '#f077af',
  surface: '#161616', border: '#2a2a2a', muted: '#8a908b',
};

function mountSettings() {
  return mount(SettingsView, {
    props: {
      preference: 'dark',
      theme: 'dark',
      colors,
      customized: {},
      colorScheme: 'pink',
      locale: 'en',
      t: createTranslator('en'),
      connectionState: 'connected',
      apiEndpoint: 'http://localhost:8080',
      userSettings: {
        editor: { ...DEFAULT_EDITOR_SETTINGS },
        files: { ...DEFAULT_FILE_SETTINGS },
        workbench: { ...DEFAULT_WORKBENCH_SETTINGS },
      },
    },
    attachTo: document.body,
  });
}

// The settings page used to show three native selects, whose popups the OS paints:
// a white sheet with a blue highlight, out of place in a dark window.
describe('settings uses themed drop-downs', () => {
  test('no native select survives anywhere on the page', async () => {
    const wrapper = mountSettings();
    await flushPromises();
    expect(wrapper.findAll('select')).toHaveLength(0);
    expect(wrapper.findAll('[role="combobox"]').length).toBeGreaterThan(0);
  });

  test('the color scheme picker emits the chosen scheme', async () => {
    const wrapper = mountSettings();
    const picker = wrapper.get('[data-testid="settings-color-scheme"]');
    await picker.get('[data-dropdown-trigger]').trigger('click');
    const rows = picker.findAll('[role="option"]');
    expect(rows.length).toBeGreaterThan(1);
    expect(wrapper.get('[data-testid="settings-color-scheme"] [aria-selected="true"]').exists()).toBe(true);
    const other = rows.find((row) => row.attributes('aria-selected') === 'false')!;
    const value = other.attributes('data-value');
    await other.trigger('click');
    expect(wrapper.emitted('changeColorScheme')).toEqual([[value]]);
  });

  test('the render-whitespace preference lists all five modes', async () => {
    const wrapper = mountSettings();
    await wrapper.get('[data-section="editor"]').trigger('click');
    await flushPromises();

    // The row is keyed by `<group>.<key>`, and the dropdown inside it is what opens.
    const row = wrapper.get('[data-setting-row="editor.renderWhitespace"]');
    const picker = row.get('.dropdown');
    await picker.get('[data-dropdown-trigger]').trigger('click');
    const values = picker.findAll('[role="option"]').map((option) => option.attributes('data-value'));
    expect(values).toEqual(['none', 'boundary', 'selection', 'trailing', 'all']);
    expect(picker.get('[aria-selected="true"]').attributes('data-value')).toBe('selection');
  });

  test('choosing a whitespace mode reports the new value', async () => {
    const wrapper = mountSettings();
    await wrapper.get('[data-section="editor"]').trigger('click');
    await flushPromises();

    const picker = wrapper.get('[data-setting-row="editor.renderWhitespace"] .dropdown');
    await picker.get('[data-dropdown-trigger]').trigger('click');
    await picker.get('[data-value="all"]').trigger('click');
    expect(wrapper.emitted('changeEditorSetting')).toContainEqual(['renderWhitespace', 'all']);
  });
});
