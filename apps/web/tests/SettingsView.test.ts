import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import SettingsView from '../src/components/SettingsView.vue';
import { createTranslator } from '../src/i18n/locale';

const props = { preference: 'system' as const, theme: 'light' as const, colors: { accent: '#f077af', background: '#ffffff', foreground: '#1a1c1f' }, colorScheme: 'pink' as const, locale: 'en' as const, t: createTranslator('en'), connectionState: 'connected' as const, apiEndpoint: '' };

describe('settings view', () => {
  test('chooses a theme, edits validated colors and resets the active theme', async () => {
    const wrapper = mount(SettingsView, { props });
    await wrapper.get('[data-theme-choice="dark"]').trigger('click');
    expect(wrapper.emitted('changeTheme')).toEqual([['dark']]);
    await wrapper.get('[data-color="background"]').setValue('#faf0ff');
    expect(wrapper.emitted('changeColor')).toEqual([['background', '#faf0ff']]);
    await wrapper.get('[data-color="background"]').setValue('invalid');
    expect(wrapper.emitted('changeColor')).toHaveLength(1);
    expect(wrapper.get('[data-color="background"]').attributes('aria-invalid')).toBe('true');
    await wrapper.get('[data-action="reset-colors"]').trigger('click');
    expect(wrapper.emitted('resetColors')).toHaveLength(1);
  });

  test('search matches translated control labels and reveals the containing real section', async () => {
    const wrapper = mount(SettingsView, { props });
    await wrapper.get('input[type="search"]').setValue('API');
    expect(wrapper.find('[data-section="appearance"]').exists()).toBe(false);
    expect(wrapper.get('[data-section="connection"]').exists()).toBe(true);
    await wrapper.get('[data-action="open-api-endpoint"]').trigger('click');
    expect(wrapper.emitted('openApiEndpoint')).toHaveLength(1);
    await wrapper.get('input[type="search"]').setValue('missing setting');
    expect(wrapper.get('[role="status"]').text()).toContain('No settings');
    await wrapper.get('input[type="search"]').setValue('');
    await wrapper.get('[data-section="general"]').trigger('click');
    await wrapper.get('[data-locale="zh-CN"]').trigger('click');
    expect(wrapper.emitted('changeLocale')).toEqual([['zh-CN']]);
    await wrapper.get('[data-action="settings-back"]').trigger('click');
    expect(wrapper.emitted('back')).toHaveLength(1);
  });
  test('marks the settings the user changed from their default', async () => {
    const plain = mount(SettingsView, { props });
    // Nothing is overridden yet, so no row carries the modified marker.
    expect(plain.findAll('.settings-row--modified')).toHaveLength(0);

    const changed = mount(SettingsView, {
      props: { ...props, colorScheme: 'green', customized: { accent: true, background: false, foreground: false } },
    });
    // The overridden accent row and the non-default colour scheme row carry it.
    const marked = changed.findAll('.settings-row--modified');
    expect(marked).toHaveLength(2);
    expect(marked[0].text()).toContain(props.t('header.colorScheme'));
    expect(marked[1].text()).toContain(props.t('settings.accent'));
  });

  test('shows the live connection state that the title row no longer carries', async () => {
    const connected = mount(SettingsView, { props });
    await connected.get('[data-section="connection"]').trigger('click');
    expect(connected.get('.settings-connection').attributes('data-state')).toBe('connected');
    expect(connected.get('.settings-connection').text()).toBe(props.t('connection.connected'));

    const unavailable = mount(SettingsView, { props: { ...props, connectionState: 'unavailable' } });
    await unavailable.get('[data-section="connection"]').trigger('click');
    expect(unavailable.get('.settings-connection').attributes('data-state')).toBe('unavailable');
    expect(unavailable.get('.settings-connection').text()).toBe(props.t('connection.unavailable'));
  });
});
