import { mount } from '@vue/test-utils';
import { describe, expect, test, vi } from 'vitest';
import CopyCommand from '../src/components/CopyCommand.vue';

describe('CopyCommand', () => {
  test('copies the visible command and reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const wrapper = mount(CopyCommand, { props: { command: 'sudo ./werkzeug/install.sh' } });

    await wrapper.get('[data-testid="copy-command-button"]').trigger('click');

    expect(writeText).toHaveBeenCalledWith('sudo ./werkzeug/install.sh');
    expect(wrapper.get('[data-testid="copy-command-status"]').text()).toContain('Copied');
  });

  test('reports clipboard failures without throwing', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    const wrapper = mount(CopyCommand, { props: { command: 'sudo ./werkzeug/install.sh' } });

    await wrapper.get('[data-testid="copy-command-button"]').trigger('click');

    expect(wrapper.get('[role="alert"]').text()).toContain('Copy failed');
  });

  test('does not mark a replacement command as copied when an older write finishes', async () => {
    let resolveWrite: (() => void) | undefined;
    const writeText = vi.fn(() => new Promise<void>((resolve) => { resolveWrite = resolve; }));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const wrapper = mount(CopyCommand, { props: { command: 'old command' } });

    await wrapper.get('[data-testid="copy-command-button"]').trigger('click');
    await wrapper.setProps({ command: 'new command' });
    resolveWrite?.();
    await Promise.resolve();
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="copy-command-status"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="copy-command-button"]').text()).toContain('Copy command');
  });
});
