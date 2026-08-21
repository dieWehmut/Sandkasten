import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import App from '../src/App.vue';
import EdgeSheet from '../src/components/EdgeSheet.vue';

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
  api.loadRuntimes.mockReset().mockResolvedValue([]);
  api.submitJob.mockReset();
  api.pollJob.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
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

  test('wires compact header actions to one active sheet at a time', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => mediaQuery(query.includes('max-width: 767px'))));
    const wrapper = mount(App, { attachTo: document.body });
    await flushPromises();

    const historyAction = wrapper.get('button[aria-label="Show history"]');
    expect(historyAction.attributes('aria-expanded')).toBe('false');
    expect(historyAction.attributes('aria-controls')).toBe('history-panel');

    await historyAction.trigger('click');
    expect(wrapper.get('[role="dialog"]').text()).toContain('Recent runs');
    expect(wrapper.get('button[aria-label="Hide history"]').attributes('aria-expanded')).toBe('true');

    await wrapper.get('button[aria-label="Show inspector"]').trigger('click');
    expect(wrapper.findAll('[role="dialog"]')).toHaveLength(1);
    expect(wrapper.get('[role="dialog"]').text()).toContain('Inspector');
    expect(wrapper.find('#history-panel').exists()).toBe(false);
    wrapper.get('#inspector-panel');

    wrapper.unmount();
  });
});
