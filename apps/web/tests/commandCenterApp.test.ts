import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import App from '../src/App.vue';
import { SETUP_WELCOME_STORAGE_KEY } from '../src/composables/useSetupWelcome';
import { WORKSPACE_STORAGE_KEY } from '../src/services/workspaceStore';

const api = vi.hoisted(() => ({ submitJob: vi.fn(), pollJob: vi.fn() }));
vi.mock('../src/services/sandkastenApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/services/sandkastenApi')>(),
  loadRuntimes: vi.fn(async () => [{ language: 'python' }]),
  submitJob: api.submitJob, pollJob: api.pollJob,
}));
beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(SETUP_WELCOME_STORAGE_KEY, 'true');
  window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({ files: { 'main.py': 'print(1)', 'other.py': 'print(2)' } }));
  api.submitJob.mockReset().mockResolvedValue({ jobId: 'job-1', status: 'JOB_STATUS_QUEUED' });
  api.pollJob.mockReset().mockImplementation(() => new Promise(() => {}));
});
afterEach(() => { window.localStorage.clear(); document.body.innerHTML = ''; });

test('Ctrl+P/E searches and opens workspace files, then shows most recent files first', async () => {
  const app = mount(App, { attachTo: document.body });
  try {
    await flushPromises();
    const opener = app.get('[data-action="quick-open"]');
    (opener.element as HTMLElement).focus();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, cancelable: true }));
    await flushPromises();
    await app.get('[role="combobox"]').setValue('other');
    await app.get('[role="combobox"]').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(app.get('[data-testid="window-title"]').text()).toContain('other.py');
    expect(app.find('[data-testid="command-palette"]').exists()).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, cancelable: true }));
    await flushPromises();
    expect(app.findAll('[data-kind="file"]')[0].text()).toContain('other.py');
    await app.get('[role="combobox"]').trigger('keydown', { key: 'Escape' });
    await flushPromises();
    expect(document.activeElement).toBe(opener.element);
  } finally { app.unmount(); }
});

test('Ctrl+Shift+P executes real commands and excludes desktop-only operations in the browser', async () => {
  const app = mount(App);
  try {
    await flushPromises();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true }));
    await flushPromises();
    expect((app.get('[role="combobox"]').element as HTMLInputElement).value).toBe('>');
    expect(app.find('[data-command="workspace.open"]').exists()).toBe(false);
    expect(app.find('[data-command="terminal.new"]').exists()).toBe(false);
    expect(app.find('[data-command="run.stop"]').exists()).toBe(false);
    await app.get('[data-command="file.new"]').trigger('click');
    await flushPromises();
    expect(app.find('[data-testid="ide-new-file-form"]').exists()).toBe(true);
  } finally { app.unmount(); }
});

test('offers the actions the visible controls offer, and honours the accelerators it prints', async () => {
  const app = mount(App, { attachTo: document.body });
  try {
    await flushPromises();
    // The palette advertises Ctrl+, so the shortcut has to be bound as well.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: true, cancelable: true }));
    await flushPromises();
    expect(app.find('[data-testid="settings-view"]').exists()).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await flushPromises();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true }));
    await flushPromises();
    // The editor history has entries once a run exists; the palette entry is only
    // enabled then, so this checks the command set rather than its availability.
    expect(app.find('[data-command="history.clear"]').exists()).toBe(false);
    expect(app.find('[data-command="workspace.refresh"]').exists()).toBe(true);
    expect(app.find('[data-command="file.delete"]').exists()).toBe(true);

    // Deleting the active file through the palette works like the row action.
    await app.get('[data-command="file.delete"]').trigger('click');
    await flushPromises();
    expect(app.find('[data-path="main.py"]').exists()).toBe(false);
  } finally { app.unmount(); }
});

test('browser F5 starts a run and Shift+F5 stops polling without reloading', async () => {
  const app = mount(App);
  try {
    await flushPromises();
    const run = new KeyboardEvent('keydown', { key: 'F5', cancelable: true });
    window.dispatchEvent(run);
    await flushPromises();
    expect(run.defaultPrevented).toBe(true);
    expect(app.get('[data-testid="ide-status-phase"]').text()).toMatch(/polling|queued/i);
    const stop = new KeyboardEvent('keydown', { key: 'F5', shiftKey: true, cancelable: true });
    window.dispatchEvent(stop);
    await flushPromises();
    expect(stop.defaultPrevented).toBe(true);
    expect(app.find('[data-action="stop-polling"]').exists()).toBe(false);
    expect(app.find('[data-action="resume-polling"]').exists()).toBe(true);
  } finally { app.unmount(); }
});
