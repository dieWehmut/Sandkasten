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

describe('App setup and locale integration', () => {
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
    await wrapper.get('[data-testid="open-setup-guide"]').trigger('click');

    wrapper.get('[data-testid="setup-welcome"]');
    expect(window.localStorage.getItem(SETUP_WELCOME_STORAGE_KEY)).toBe('true');
  });
});
