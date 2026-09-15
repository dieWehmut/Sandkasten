import { describe, expect, test, vi } from 'vitest';
import {
  createTranslator,
  detectLocale,
  isLocale,
  LOCALE_STORAGE_KEY,
  type Locale,
} from '../src/i18n/locale';
import type { MessageKey } from '../src/i18n/messages';
import { useLocale, type LocaleNavigator, type LocaleStorage } from '../src/composables/useLocale';

function createStorage(saved?: string) {
  return {
    getItem: vi.fn<(key: string) => string | null>(() => saved ?? null),
    setItem: vi.fn<(key: string, value: string) => void>(),
  } satisfies LocaleStorage;
}

function createNavigator(language: string): LocaleNavigator {
  return { language };
}

describe('locale detection', () => {
  test.each([
    ['zh', 'zh-CN'],
    ['zh-CN', 'zh-CN'],
    ['zh-TW', 'zh-CN'],
    ['en-US', 'en'],
    ['ja-JP', 'en'],
    ['', 'en'],
  ])('maps browser language %s to %s', (language, expected) => {
    expect(detectLocale(language)).toBe(expected);
  });

  test('recognizes only supported locale values', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('zh-CN')).toBe(true);
    expect(isLocale('zh')).toBe(false);
    expect(isLocale('fr')).toBe(false);
  });
});

describe('useLocale', () => {
  test('uses English when no stored locale exists and the browser is not Chinese', () => {
    const root = document.createElement('html');
    const storage = createStorage();

    const controller = useLocale({ root, storage, navigator: createNavigator('en-US') });

    expect(controller.locale.value satisfies Locale).toBe('en');
    expect(controller.hasExplicitPreference.value).toBe(false);
    expect(root.lang).toBe('en');
    expect(LOCALE_STORAGE_KEY).toBe('sandkasten-locale');
    expect(storage.getItem).toHaveBeenCalledWith('sandkasten-locale');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  test('detects Chinese browser languages and updates html.lang', () => {
    const root = document.createElement('html');

    const controller = useLocale({ root, storage: createStorage(), navigator: createNavigator('zh-TW') });

    expect(controller.locale.value).toBe('zh-CN');
    expect(root.getAttribute('lang')).toBe('zh-CN');
  });

  test('accepts an injectable document environment for html.lang updates', () => {
    const root = document.createElement('html');

    useLocale({ document: { documentElement: root }, storage: createStorage(), navigator: createNavigator('zh') });

    expect(root.lang).toBe('zh-CN');
  });

  test('falls back to browser detection for unsupported stored values', () => {
    const root = document.createElement('html');
    const storage = createStorage('fr');

    const controller = useLocale({ root, storage, navigator: createNavigator('zh-CN') });

    expect(controller.locale.value).toBe('zh-CN');
    expect(controller.hasExplicitPreference.value).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  test('restores supported values, persists explicit changes, and updates html.lang', () => {
    const root = document.createElement('html');
    const storage = createStorage('en');
    const controller = useLocale({ root, storage, navigator: createNavigator('zh-CN') });

    expect(controller.locale.value).toBe('en');
    expect(controller.hasExplicitPreference.value).toBe(true);
    expect(controller.t('setup.title')).toBe('Welcome to Sandkasten');
    expect(root.lang).toBe('en');
    expect(storage.setItem).not.toHaveBeenCalled();

    controller.setLocale('zh-CN');

    expect(controller.locale.value).toBe('zh-CN');
    expect(controller.hasExplicitPreference.value).toBe(true);
    expect(controller.t('setup.title')).toBe('欢迎使用 Sandkasten');
    expect(root.lang).toBe('zh-CN');
    expect(storage.setItem).toHaveBeenCalledWith('sandkasten-locale', 'zh-CN');
  });

  test('translates catalog keys and returns the key for missing translations', () => {
    const translator = createTranslator('zh-CN');
    const fallbackTranslator = createTranslator('zh-CN', {
      en: { 'fallback.only': 'English fallback' },
      'zh-CN': {},
    });

    expect(translator('brand.name')).toBe('Sandkasten');
    expect(fallbackTranslator('fallback.only' as MessageKey)).toBe('English fallback');
    expect(fallbackTranslator('missing.translation' as MessageKey)).toBe('missing.translation');
  });
});
