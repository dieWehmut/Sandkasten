import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, test } from 'vitest';
import App from '../src/App.vue';
import AppHeader from '../src/components/AppHeader.vue';
import LocaleSwitcher from '../src/components/LocaleSwitcher.vue';
import { createTranslator } from '../src/i18n/locale';
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

describe('applied color scheme', () => {
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

    // The settings screen owns the picker now, so this covers the behaviour it
    // depends on: the document attribute and the stored preference both follow
    // the choice.
    expect(document.documentElement.getAttribute('data-color-scheme')).toBe('white');
    expect(window.localStorage.getItem(COLOR_SCHEME_STORAGE_KEY)).toBe('white');
  });
});

