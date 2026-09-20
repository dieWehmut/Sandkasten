import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, test, vi } from 'vitest';
import AppHeader from '../src/components/AppHeader.vue';
import { createTranslator } from '../src/i18n/locale';

describe('integrated desktop header', () => {
  test('opens the localized native menu below its button and clears the active state on dismissal', async () => {
    let dismiss!: () => void;
    const showMenu = vi.fn(() => new Promise<void>((resolve) => { dismiss = resolve; }));
    const chrome = { integrated: true as const, showMenu, setTheme: vi.fn().mockResolvedValue(undefined) };
    const wrapper = mount(AppHeader, {
      props: { connectionState: 'connected', chrome, platform: 'win32', locale: 'zh-CN', t: createTranslator('zh-CN'), windowTitle: 'hello.py — demo — Sandkasten' },
    });
    expect(wrapper.findAll('[data-menu]').map((button) => button.attributes('data-menu'))).toEqual(['file', 'edit', 'view', 'help']);
    const button = wrapper.get('[data-menu="file"]');
    vi.spyOn(button.element, 'getBoundingClientRect').mockReturnValue({ left: 42, bottom: 36 } as DOMRect);
    expect(button.text()).toBe('文件');
    expect(wrapper.get('[data-testid="window-title"]').text()).toBe('hello.py — demo — Sandkasten');
    await button.trigger('click');
    expect(showMenu).toHaveBeenCalledWith({ id: 'file', x: 42, y: 36, locale: 'zh-CN' });
    expect(button.attributes('aria-expanded')).toBe('true');
    dismiss();
    await flushPromises();
    expect(button.attributes('aria-expanded')).toBe('false');
    wrapper.unmount();
  });

  test('opens menus from the keyboard and follows light/dark changes in the native controls', async () => {
    const chrome = { integrated: true as const, showMenu: vi.fn().mockResolvedValue(undefined), setTheme: vi.fn().mockResolvedValue(undefined) };
    const wrapper = mount(AppHeader, { props: { connectionState: 'connected', chrome, theme: 'light' } });
    expect(chrome.setTheme).toHaveBeenCalledWith('light');
    await wrapper.setProps({ theme: 'dark' });
    expect(chrome.setTheme).toHaveBeenLastCalledWith('dark');
    await wrapper.get('[data-menu="edit"]').trigger('keydown', { key: 'ArrowDown' });
    expect(chrome.showMenu).toHaveBeenCalledWith(expect.objectContaining({ id: 'edit', locale: 'en' }));
    wrapper.unmount();
  });

  test('keeps browser and older desktop bundles usable without a native menu bridge', () => {
    const wrapper = mount(AppHeader, { props: { connectionState: 'connected' } });
    expect(wrapper.find('[data-testid="desktop-menu"]').exists()).toBe(false);
    expect(wrapper.get('.brand').attributes('aria-label')).toBe('Sandkasten home');
    expect(wrapper.find('.brand strong').exists()).toBe(false);
    expect(wrapper.find('.header-actions').exists()).toBe(false);
    expect(wrapper.find('.connection-status').exists()).toBe(false);
    wrapper.unmount();
  });

  test('recovers from a rejected native menu instead of leaving it expanded', async () => {
    const chrome = { integrated: true as const, showMenu: vi.fn().mockRejectedValue(new Error('Window closed')), setTheme: vi.fn().mockResolvedValue(undefined) };
    const wrapper = mount(AppHeader, { props: { connectionState: 'connected', chrome } });
    await wrapper.get('[data-menu="help"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-menu="help"]').attributes('aria-expanded')).toBe('false');
    expect(wrapper.get('[role="alert"]').text()).toContain('menu');
    wrapper.unmount();
  });
});
