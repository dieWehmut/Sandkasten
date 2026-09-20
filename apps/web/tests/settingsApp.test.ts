import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, expect, test, vi } from 'vitest';
import App from '../src/App.vue';
import SourceEditor from '../src/components/SourceEditor.vue';
import { SETUP_WELCOME_STORAGE_KEY } from '../src/composables/useSetupWelcome';

vi.mock('../src/services/sandkastenApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/services/sandkastenApi')>(),
  loadRuntimes: async () => [],
}));
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(SETUP_WELCOME_STORAGE_KEY, 'true');
});

test.each([1440, 390])('settings preserves the editor instance and applies persistent theme changes at width %i', async (width) => {
  const previousWidth = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  const wrapper = mount(App, { attachTo: document.body });
  try {
    await flushPromises();
    const editor = wrapper.getComponent(SourceEditor);
    editor.vm.$emit('update:modelValue', 'print("unsaved settings test")');
    await flushPromises();
    // `wrapper.vm` is a fresh proxy on every read, so identity has to be read
    // from the component instance the proxy delegates to.
    const editorInstance = editor.vm.$;
    await wrapper.get('[data-action="open-settings"]').trigger('click');
    expect(wrapper.get('[data-testid="settings-view"]').isVisible()).toBe(true);
    expect(wrapper.get('[data-testid="workbench-shell"]').isVisible()).toBe(false);
    await wrapper.get('[data-theme-choice="dark"]').trigger('click');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('sandkasten-theme')).toBe('dark');
    await wrapper.get('[data-color="background"]').setValue('#222233');
    expect(document.documentElement.style.getPropertyValue('--surface')).toBe('#222233');
    await wrapper.get('[data-action="settings-back"]').trigger('click');
    expect(wrapper.getComponent(SourceEditor).vm.$).toBe(editorInstance);
    expect(editorInstance.isMounted).toBe(true);
    expect(wrapper.getComponent(SourceEditor).props('modelValue')).toBe('print("unsaved settings test")');
    expect(wrapper.get('[data-testid="workbench-shell"]').isVisible()).toBe(true);
    await wrapper.get('[data-action="open-settings"]').trigger('click');
    await wrapper.get('[data-section="workbench"]').trigger('click');
    await wrapper.get('[data-action="settings-show-history"]').trigger('click');
    expect(wrapper.find('[data-testid="settings-view"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="workbench-shell"]').isVisible()).toBe(true);
  } finally {
    wrapper.unmount();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: previousWidth });
    document.documentElement.removeAttribute('style');
  }
});
