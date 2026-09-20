import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import App from '../src/App.vue';
import EdgeSheet from '../src/components/EdgeSheet.vue';
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

function mediaQuery(matches: boolean): MediaQueryList {
  return {
    matches,
    media: '',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
}

beforeEach(() => {
  window.localStorage.setItem(SETUP_WELCOME_STORAGE_KEY, 'true');
  api.loadRuntimes.mockReset().mockResolvedValue([]);
  api.submitJob.mockReset();
  api.pollJob.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.body.innerHTML = '';
});

describe('Setup welcome focus management', () => {
  test('focuses the setup title on a first visit without an opening control', async () => {
    window.localStorage.clear();
    const wrapper = mount(App, { attachTo: document.body });
    await nextTick();

    const title = wrapper.get('[data-testid="setup-title"]');
    expect(title.attributes('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(title.element);

    wrapper.unmount();
  });

  test('focuses the setup title when reopened and hands focus to the search control after dismissal', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushPromises();

    // The reduced title row has no setup button, so the guide opens from the
    // command palette the way a keyboard user would reach it.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true }));
    await flushPromises();
    await wrapper.get('[data-command="view.toggleSetup"]').trigger('click');
    await nextTick();

    const title = wrapper.get('[data-testid="setup-title"]');
    expect(title.attributes('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(title.element);
    expect(wrapper.find('[data-testid="app-header"]').exists()).toBe(false);

    const dismiss = wrapper.get('[data-testid="setup-dismiss"]');
    (dismiss.element as HTMLElement).focus();
    await dismiss.trigger('click');
    await nextTick();

    // Dismissal rebuilds the title row; focus lands on the search control it
    // now owns instead of being dropped on a detached button.
    const search = wrapper.get('[data-action="quick-open"]');
    expect(search.element.isConnected).toBe(true);
    expect(document.activeElement).toBe(search.element);

    wrapper.unmount();
  });
});

describe('EdgeSheet', () => {
  test('traps focus, closes with Escape, and restores the opening control', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Open history';
    document.body.append(trigger);
    trigger.focus();

    const wrapper = mount(EdgeSheet, {
      attachTo: document.body,
      props: { open: true, side: 'left', title: 'Recent runs' },
      slots: { default: '<button id="first-action">First</button><button id="last-action">Last</button>' },
    });
    await nextTick();

    const dialog = wrapper.get('[role="dialog"]');
    expect(dialog.attributes('aria-modal')).toBe('true');
    expect(dialog.attributes('aria-labelledby')).toBeTruthy();
    expect(wrapper.get(`#${dialog.attributes('aria-labelledby')}`).text()).toBe('Recent runs');
    expect(document.activeElement).toBe(wrapper.get('button[aria-label="Close Recent runs"]').element);

    await dialog.trigger('keydown', { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(wrapper.get('#last-action').element);

    await dialog.trigger('keydown', { key: 'Tab' });
    expect(document.activeElement).toBe(wrapper.get('button[aria-label="Close Recent runs"]').element);

    await dialog.trigger('keydown', { key: 'Escape' });
    expect(wrapper.emitted('close')).toHaveLength(1);

    await wrapper.setProps({ open: false });
    await nextTick();
    expect(document.activeElement).toBe(trigger);

    wrapper.unmount();
  });

  test('wires the compact history and inspector commands to one active sheet at a time', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => mediaQuery(query.includes('max-width: 767px'))));
    const wrapper = mount(App, { attachTo: document.body });
    await flushPromises();

    // The compact title row no longer carries the sheet buttons, so the
    // palette commands are the user's route to the same panels.
    const runCommand = async (id: string) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true }));
      await flushPromises();
      await wrapper.get(`[data-command="${id}"]`).trigger('click');
      await nextTick();
    };

    await runCommand('view.history');
    expect(wrapper.get('[role="dialog"]').text()).toContain('Recent runs');

    await runCommand('view.inspector');
    expect(wrapper.findAll('[role="dialog"]')).toHaveLength(1);
    const inspectorSheet = wrapper.get('[role="dialog"]');
    expect(inspectorSheet.text()).toContain('Inspector');
    expect(wrapper.find('#history-panel').exists()).toBe(false);
    wrapper.get('#inspector-panel');
    expect(inspectorSheet.element.contains(document.activeElement)).toBe(true);

    wrapper.unmount();
  });

  test('keeps the body locked and focus inside when switching inspector back to history', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => mediaQuery(query.includes('max-width: 767px'))));
    const wrapper = mount(App, { attachTo: document.body });
    await flushPromises();

    const runCommand = async (id: string) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true }));
      await flushPromises();
      await wrapper.get(`[data-command="${id}"]`).trigger('click');
      await nextTick();
    };

    await runCommand('view.inspector');
    expect(wrapper.get('[role="dialog"]').text()).toContain('Inspector');
    expect(document.body.style.overflow).toBe('hidden');

    await runCommand('view.history');
    expect(wrapper.findAll('[role="dialog"]')).toHaveLength(1);
    const historySheet = wrapper.get('[role="dialog"]');
    expect(historySheet.text()).toContain('Recent runs');
    expect(document.body.style.overflow).toBe('hidden');
    expect(historySheet.element.contains(document.activeElement)).toBe(true);

    wrapper.unmount();
    expect(document.body.style.overflow).toBe('');
  });
});