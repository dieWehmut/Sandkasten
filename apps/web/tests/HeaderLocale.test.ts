import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import AppHeader from '../src/components/AppHeader.vue';
import ConnectionStatus from '../src/components/ConnectionStatus.vue';
import HeaderActions from '../src/components/HeaderActions.vue';
import LocaleSwitcher from '../src/components/LocaleSwitcher.vue';
import { createTranslator } from '../src/i18n/locale';
import { TRANSLATOR_KEY } from '../src/i18n/useTranslation';

describe('LocaleSwitcher', () => {
  test('exposes an accessible two-locale control and emits the selected locale', async () => {
    const t = createTranslator('en');
    const wrapper = mount(LocaleSwitcher, { props: { locale: 'en', t } });

    const switcher = wrapper.get('[data-testid="locale-switcher"]');
    const english = switcher.get('button[data-locale="en"]');
    const chinese = switcher.get('button[data-locale="zh-CN"]');

    expect(switcher.attributes('role')).toBe('group');
    expect(switcher.attributes('aria-label')).toBe(t('locale.label'));
    expect(english.attributes('aria-pressed')).toBe('true');
    expect(english.attributes('aria-label')).toBe(t('locale.switchToEnglish'));
    expect(chinese.attributes('aria-pressed')).toBe('false');
    expect(chinese.attributes('aria-label')).toBe(t('locale.switchToChinese'));
    expect(chinese.text()).toBe('中文');
    expect(english.attributes('data-action')).toBe('set-locale-en');
    expect(chinese.attributes('data-action')).toBe('set-locale-zh-CN');

    await chinese.trigger('click');

    expect(wrapper.emitted('change')).toEqual([['zh-CN']]);
  });
});

describe('localized header controls', () => {
  test('translates action labels, keeps stable action hooks, and forwards controls', async () => {
    const t = createTranslator('zh-CN');
    const wrapper = mount(HeaderActions, {
      props: {
        historyOpen: false,
        inspectorOpen: true,
        theme: 'dark',
        locale: 'zh-CN',
        t,
      },
    });

    expect(wrapper.get('nav').attributes('aria-label')).toBe(t('header.actions'));
    expect(wrapper.get('[data-action="open-setup-guide"]').attributes('aria-label')).toBe(t('header.setup'));
    expect(wrapper.get('[data-action="toggle-history"]').attributes('aria-label')).toBe(t('header.history.show'));
    expect(wrapper.get('[data-action="toggle-inspector"]').attributes('aria-label')).toBe(t('header.inspector.hide'));
    expect(wrapper.get('[data-action="toggle-theme"]').attributes('aria-label')).toBe(t('header.theme.useLight'));
    expect(wrapper.get('[data-action="open-github"]').attributes('aria-label')).toBe(t('header.github'));

    await wrapper.get('[data-testid="open-setup-guide"]').trigger('click');
    await wrapper.get('[data-action="toggle-history"]').trigger('click');
    await wrapper.get('[data-action="toggle-inspector"]').trigger('click');
    await wrapper.get('[data-action="toggle-theme"]').trigger('click');
    await wrapper.get('[data-action="open-github"]').trigger('click');
    await wrapper.get('button[data-locale="en"]').trigger('click');

    expect(wrapper.emitted('openSetup')).toHaveLength(1);
    expect(wrapper.emitted('toggleHistory')).toHaveLength(1);
    expect(wrapper.emitted('toggleInspector')).toHaveLength(1);
    expect(wrapper.emitted('toggleTheme')).toHaveLength(1);
    expect(wrapper.emitted('openGithub')).toHaveLength(1);
    expect(wrapper.emitted('changeLocale')).toEqual([['en']]);
  });

  test('passes locale and translated connection state through AppHeader', async () => {
    const t = createTranslator('zh-CN');
    const wrapper = mount(AppHeader, {
      props: {
        connectionState: 'connected',
        locale: 'zh-CN',
        t,
      },
    });

    expect(wrapper.get('.brand').attributes('aria-label')).toBe(t('brand.home'));
    expect(wrapper.get('.brand strong').text()).toBe(t('brand.name'));
    expect(wrapper.get('.connection-status').text()).toBe(t('connection.connected'));

    await wrapper.get('[data-testid="open-setup-guide"]').trigger('click');
    await wrapper.get('button[data-locale="en"]').trigger('click');

    expect(wrapper.emitted('openSetup')).toHaveLength(1);
    expect(wrapper.emitted('changeLocale')).toEqual([['en']]);
  });
});

describe('ConnectionStatus locale fallback', () => {
  test('keeps standalone English defaults and accepts an injected translator', () => {
    const standalone = mount(ConnectionStatus, { props: { state: 'unavailable' } });
    const t = createTranslator('zh-CN');
    const injected = mount(ConnectionStatus, {
      props: { state: 'connecting' },
      global: { provide: { [TRANSLATOR_KEY as symbol]: t } },
    });

    expect(standalone.text()).toBe('Unavailable');
    expect(injected.text()).toBe(t('connection.connecting'));
  });
});
