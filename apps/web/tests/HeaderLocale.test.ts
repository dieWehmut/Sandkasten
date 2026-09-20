import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, describe, expect, test } from 'vitest';
import App from '../src/App.vue';
import AppHeader from '../src/components/AppHeader.vue';
import ColorSchemeSwitcher from '../src/components/ColorSchemeSwitcher.vue';
import ConnectionStatus from '../src/components/ConnectionStatus.vue';
import HeaderActions from '../src/components/HeaderActions.vue';
import LocaleSwitcher from '../src/components/LocaleSwitcher.vue';
import { createTranslator } from '../src/i18n/locale';
import { TRANSLATOR_KEY } from '../src/i18n/useTranslation';
import { COLOR_SCHEME_STORAGE_KEY, useColorScheme } from '../src/composables/useColorScheme';
import { SETUP_WELCOME_STORAGE_KEY } from '../src/composables/useSetupWelcome';

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-color-scheme');
});

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

  test('passes locale and translated search metadata through AppHeader', async () => {
    const t = createTranslator('zh-CN');
    const wrapper = mount(AppHeader, {
      props: { locale: 'zh-CN', t, windowTitle: 'main.py', canBack: true, canForward: false },
    });

    // The reduced title row keeps the brand mark, the history arrows, and the
    // centered search control; the removed status and setup controls are gone.
    expect(wrapper.get('.brand').attributes('aria-label')).toBe(t('brand.home'));
    expect(wrapper.find('.brand strong').exists()).toBe(false);
    expect(wrapper.find('.connection-status').exists()).toBe(false);
    expect(wrapper.find('[data-testid="locale-switcher"]').exists()).toBe(false);

    const search = wrapper.get('[data-action="quick-open"]');
    expect(search.attributes('aria-label')).toBe(t('palette.title'));
    expect(search.attributes('aria-expanded')).toBe('false');
    expect(search.text()).toBe('main.py');
    expect(search.attributes('aria-keyshortcuts')).toBe('Control+p Control+e');

    await search.trigger('click');

    expect(wrapper.emitted('quickOpen')).toHaveLength(1);
    expect(wrapper.emitted('navigateBack')).toBeUndefined();
  });
});

describe('ConnectionStatus locale fallback', () => {
  test('exposes a stable hook for configuring the API endpoint', () => {
    const t = createTranslator('en');
    const wrapper = mount(HeaderActions, { props: { t } });
    expect(wrapper.get('[data-action="open-api-endpoint"]').attributes('aria-label')).toBe(t('apiEndpoint.open'));
    return wrapper.get('[data-action="open-api-endpoint"]').trigger('click').then(() => {
      expect(wrapper.emitted('openApiEndpoint')).toHaveLength(1);
    });
  });

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

describe('color scheme switcher', () => {
  test('exposes every scheme with stable hooks and localized labels', async () => {
    const t = createTranslator('zh-CN');
    const wrapper = mount(ColorSchemeSwitcher, {
      props: { colorScheme: 'purple', locale: 'zh-CN', t },
    });

    const toggle = wrapper.get('[data-action="toggle-color-scheme"]');
    expect(toggle.attributes('aria-label')).toBe(t('header.colorScheme'));
    await toggle.trigger('click');

    const menu = wrapper.get('[data-testid="color-scheme-menu"]');
    expect(menu.attributes('aria-label')).toBe(t('header.colorScheme'));
    expect(menu.findAll('button')).toHaveLength(5);
    for (const scheme of ['green', 'purple', 'pink', 'white', 'black']) {
      const button = wrapper.get(`[data-action="set-color-scheme-${scheme}"]`);
      expect(button.attributes('aria-label')).toBe(t(`colorScheme.${scheme}` as never));
      expect(button.attributes('aria-pressed')).toBe(String(scheme === 'purple'));
    }

    await wrapper.get('[data-action="set-color-scheme-black"]').trigger('click');

    expect(wrapper.emitted('change')).toEqual([['black']]);
  });

  test('forwards the active scheme and selection through the header', async () => {
    const wrapper = mount(HeaderActions, {
      props: { theme: 'light', colorScheme: 'pink', locale: 'en' },
    });

    await wrapper.get('[data-action="toggle-color-scheme"]').trigger('click');
    expect(wrapper.get('[data-action="set-color-scheme-pink"]').attributes('aria-pressed')).toBe('true');
    await wrapper.get('[data-action="set-color-scheme-green"]').trigger('click');

    expect(wrapper.emitted('changeColorScheme')).toEqual([['green']]);
  });

  test('applies the stored scheme to the document before the workbench renders', async () => {
    window.localStorage.setItem(SETUP_WELCOME_STORAGE_KEY, 'true');
    window.localStorage.setItem('sandkasten-color-scheme', 'pink');
    mount(App);

    expect(document.documentElement.getAttribute('data-color-scheme')).toBe('pink');
  });

  test('persists and applies a scheme chosen through the color scheme controller', async () => {
    window.localStorage.setItem(SETUP_WELCOME_STORAGE_KEY, 'true');
    const scheme = useColorScheme();

    scheme.setColorScheme('white');

    // The reduced title row moved the picker out of the header, so this
    // covers the behaviour the picker itself still depends on: the document
    // attribute and the stored preference both follow the choice.
    expect(document.documentElement.getAttribute('data-color-scheme')).toBe('white');
    expect(window.localStorage.getItem(COLOR_SCHEME_STORAGE_KEY)).toBe('white');
  });
});

describe('color scheme switcher menu state', () => {
  test('starts closed and toggles the accessible menu on demand', async () => {
    const wrapper = mount(ColorSchemeSwitcher, { props: { colorScheme: 'green', locale: 'en' }, attachTo: document.body });
    const root = wrapper.get('.color-scheme-switcher');
    const toggle = wrapper.get('[data-action="toggle-color-scheme"]');

    expect(root.attributes('data-open')).toBe('false');
    expect(toggle.attributes('aria-expanded')).toBe('false');
    expect(toggle.attributes('aria-haspopup')).toBe('true');
    expect(wrapper.find('[data-testid="color-scheme-menu"]').exists()).toBe(false);

    await toggle.trigger('click');
    expect(root.attributes('data-open')).toBe('true');
    expect(toggle.attributes('aria-expanded')).toBe('true');
    expect(wrapper.get('[data-testid="color-scheme-menu"]').attributes('role')).toBe('group');
    wrapper.unmount();
  });

  test('closes the menu and reports the selection after picking a scheme', async () => {
    const wrapper = mount(ColorSchemeSwitcher, { props: { colorScheme: 'green', locale: 'en' }, attachTo: document.body });

    await wrapper.get('[data-action="toggle-color-scheme"]').trigger('click');
    await wrapper.get('[data-action="set-color-scheme-purple"]').trigger('click');

    expect(wrapper.get('.color-scheme-switcher').attributes('data-open')).toBe('false');
    expect(wrapper.find('[data-testid="color-scheme-menu"]').exists()).toBe(false);
    expect(wrapper.emitted('change')).toEqual([['purple']]);
    wrapper.unmount();
  });

  test('closes the menu on Escape and on an outside pointer press', async () => {
    const wrapper = mount(ColorSchemeSwitcher, { props: { colorScheme: 'green', locale: 'en' }, attachTo: document.body });
    const toggle = wrapper.get('[data-action="toggle-color-scheme"]');

    await toggle.trigger('click');
    document.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    await nextTick();
    expect(wrapper.get('.color-scheme-switcher').attributes('data-open')).toBe('false');

    await toggle.trigger('click');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    expect(wrapper.get('.color-scheme-switcher').attributes('data-open')).toBe('false');
    wrapper.unmount();
  });

  test('keeps the menu open when the pointer presses a control inside it', async () => {
    const wrapper = mount(ColorSchemeSwitcher, { props: { colorScheme: 'green', locale: 'en' }, attachTo: document.body });

    await wrapper.get('[data-action="toggle-color-scheme"]').trigger('click');
    const inside = wrapper.get('[data-action="set-color-scheme-pink"]');
    inside.element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    await nextTick();

    expect(wrapper.get('.color-scheme-switcher').attributes('data-open')).toBe('true');
    wrapper.unmount();
  });
});
