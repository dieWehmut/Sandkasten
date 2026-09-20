import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import App from '../src/App.vue';
import { LOCALE_STORAGE_KEY } from '../src/i18n/locale';
import { SETUP_WELCOME_STORAGE_KEY } from '../src/composables/useSetupWelcome';

const api = vi.hoisted(() => ({
  loadRuntimes: vi.fn(),
  submitJob: vi.fn(),
  pollJob: vi.fn(),
}));

vi.mock('../src/services/sandkastenApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/services/sandkastenApi')>(),
  loadRuntimes: api.loadRuntimes,
  submitJob: api.submitJob,
  pollJob: api.pollJob,
}));

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.lang = '';
  api.loadRuntimes.mockReset().mockResolvedValue([]);
  api.submitJob.mockReset();
  api.pollJob.mockReset();
});

// The reduced title row dropped the setup button, so the palette command is
// the user's route back into the guide.
async function openSetupFromPalette(wrapper: ReturnType<typeof mount>): Promise<void> {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true }));
  await flushPromises();
  await wrapper.get('[data-command="view.toggleSetup"]').trigger('click');
  await flushPromises();
}

describe('App setup and locale integration', () => {
  test('keeps connection settings available without a standalone runtime failure banner', async () => {
    window.localStorage.setItem(SETUP_WELCOME_STORAGE_KEY, 'true');
    api.loadRuntimes.mockRejectedValue(new Error('Failed to fetch'));
    const wrapper = mount(App);
    try {
      await flushPromises();
      // The header no longer carries the status line, so the run bar owns it
      // and the failure still must not add a standalone banner.
      expect(wrapper.find('.connection-error').exists()).toBe(false);
      expect(wrapper.get('.ide-status__badge').attributes('data-connection')).toBe('unavailable');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true }));
      await flushPromises();
      await wrapper.get('[data-command="apiEndpoint.open"]').trigger('click');
      await flushPromises();
      expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    } finally {
      wrapper.unmount();
    }
  });

  test('releases the desktop viewport lock for first-visit and reopened setup', async () => {
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    const wrapper = mount(App);
    try {
      expect(wrapper.get('[data-testid="app-shell"]').classes()).not.toContain('workbench-app--ide');
      await wrapper.get('[data-testid="setup-dismiss"]').trigger('click');
      await flushPromises();
      expect(wrapper.get('[data-testid="app-shell"]').classes()).toContain('workbench-app--ide');
      await openSetupFromPalette(wrapper);
      expect(wrapper.get('[data-testid="app-shell"]').classes()).not.toContain('workbench-app--ide');
    } finally {
      wrapper.unmount();
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: previousWidth });
    }
  });
  test('shows setup before loading runtimes, then persists dismissal and enters the workbench', async () => {
    const wrapper = mount(App);

    wrapper.get('[data-testid="setup-welcome"]');
    expect(wrapper.find('[data-testid="app-header"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="workbench-shell"]').exists()).toBe(false);
    expect(api.loadRuntimes).not.toHaveBeenCalled();

    await wrapper.get('[data-testid="setup-dismiss"]').trigger('click');
    await flushPromises();

    wrapper.get('[data-testid="workbench-shell"]');
    expect(window.localStorage.getItem(SETUP_WELCOME_STORAGE_KEY)).toBe('true');
    expect(api.loadRuntimes).toHaveBeenCalledTimes(1);
  });

  test('switches the whole application to Chinese, persists it, and updates html lang', async () => {
    const wrapper = mount(App);

    await wrapper.get('[data-testid="locale-switcher"] [data-locale="zh-CN"]').trigger('click');

    expect(wrapper.get('[data-testid="setup-title"]').text()).toBe('欢迎使用 Sandkasten');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(wrapper.get('[data-testid="locale-switcher"] [data-locale="en"]').attributes('aria-pressed')).toBe('false');
  });

  test('reopens the setup guide from the workbench without clearing the seen flag', async () => {
    window.localStorage.setItem(SETUP_WELCOME_STORAGE_KEY, 'true');
    const wrapper = mount(App);
    await flushPromises();

    wrapper.get('[data-testid="workbench-shell"]');
    await openSetupFromPalette(wrapper);

    wrapper.get('[data-testid="setup-welcome"]');
    expect(window.localStorage.getItem(SETUP_WELCOME_STORAGE_KEY)).toBe('true');
  });
});
