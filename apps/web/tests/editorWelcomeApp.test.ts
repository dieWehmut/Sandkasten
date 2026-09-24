import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import App from '../src/App.vue';
import SourceEditor from '../src/components/SourceEditor.vue';
import { SETUP_WELCOME_STORAGE_KEY } from '../src/composables/useSetupWelcome';
import { SCRATCH_FILE_NAME } from '../src/services/workspaceStore';

vi.mock('../src/services/sandkastenApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/services/sandkastenApi')>(),
  loadRuntimes: vi.fn(async () => [{ language: 'python', version: '3.13' }]),
}));

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(SETUP_WELCOME_STORAGE_KEY, 'true');
});

afterEach(() => window.localStorage.clear());

test('creates browser scratch files from the welcome with the explorer hidden, then opens setup', async () => {
  const wrapper = mount(App);
  await flushPromises();
  expect(wrapper.findComponent(SourceEditor).exists()).toBe(true);
  await wrapper.get(`[data-action="ide-close-${SCRATCH_FILE_NAME}"]`).trigger('click');
  await wrapper.get('[data-activity="runs"]').trigger('click');
  await wrapper.get('[data-action="ide-collapse-sidebar"]').trigger('click');
  expect(wrapper.find('.ide-sidebar').exists()).toBe(false);

  await wrapper.get('[data-action="welcome-new-file"]').trigger('click');
  expect(wrapper.find('[data-testid="ide-new-file-form"]').exists()).toBe(true);
  expect(wrapper.find('[data-testid="workspace-explorer"]').exists()).toBe(true);
  await wrapper.get('input[name="fileName"]').setValue('welcome.py');
  await wrapper.get('[data-testid="ide-new-file-form"]').trigger('submit');
  await flushPromises();
  expect(wrapper.findComponent(SourceEditor).exists()).toBe(true);
  expect(wrapper.find('[data-testid="editor-welcome"]').exists()).toBe(false);

  await wrapper.get('[data-action="ide-close-welcome.py"]').trigger('click');
  // Closing the last file returns the welcome, which now lists that file and
  // reopens it from the recent rows.
  const recent = wrapper.findAll('.editor-welcome__recent-item');
  expect(recent.map((row) => row.find('.editor-welcome__path').text())).toContain('welcome.py');
  const entry = recent.find((row) => row.find('.editor-welcome__path').text() === 'welcome.py');
  await entry?.trigger('click');
  await flushPromises();
  expect(wrapper.findComponent(SourceEditor).exists()).toBe(true);
  expect(wrapper.find('[data-testid="editor-welcome"]').exists()).toBe(false);

  await wrapper.get('[data-action="ide-close-welcome.py"]').trigger('click');
  await wrapper.get('[data-action="welcome-open-setup"]').trigger('click');
  expect(wrapper.find('[data-testid="setup-welcome"]').exists()).toBe(true);
  wrapper.unmount();
});
