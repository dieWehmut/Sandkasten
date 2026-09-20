import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import App from '../src/App.vue';
import { SETUP_WELCOME_STORAGE_KEY } from '../src/composables/useSetupWelcome';
import { WORKSPACE_STORAGE_KEY } from '../src/services/workspaceStore';

vi.mock('../src/services/sandkastenApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/services/sandkastenApi')>(),
  loadRuntimes: vi.fn(async () => []),
}));

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(SETUP_WELCOME_STORAGE_KEY, 'true');
  window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({ files: { 'a.py': 'a', 'b.py': 'b' } }));
});
afterEach(() => window.localStorage.clear());

test('header arrows and Alt+Left reopen files after a tab closes', async () => {
  const wrapper = mount(App);
  try {
    await flushPromises();
    expect(wrapper.get('[data-action="navigate-back"]').attributes('disabled')).toBeDefined();
    await wrapper.get('[data-action="ide-open-b.py"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-action="navigate-back"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-testid="window-title"]').text()).toContain('a.py');
    await wrapper.get('[data-action="ide-close-b.py"]').trigger('click');
    await wrapper.get('[data-action="navigate-forward"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-testid="window-title"]').text()).toContain('b.py');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, cancelable: true }));
    await flushPromises();
    expect(wrapper.get('[data-testid="window-title"]').text()).toContain('a.py');
  } finally { wrapper.unmount(); }
});
