import { messages, type MessageKey } from './messages';

export type Locale = 'en' | 'zh-CN';

export const SUPPORTED_LOCALES = ['en', 'zh-CN'] as const satisfies readonly Locale[];
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_STORAGE_KEY = 'sandkasten-locale';

export type Translator = (key: MessageKey) => string;

export type LocaleCatalog = Readonly<Record<Locale, Readonly<Record<string, string>>>>;

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'zh-CN';
}

export function detectLocale(language?: string | { readonly language?: string } | null): Locale {
  const source = typeof language === 'string' ? language : language?.language;
  const normalized = (source ?? '').trim().toLowerCase();
  return normalized === 'zh' || normalized === 'zh-cn' || normalized === 'zh-tw'
    ? 'zh-CN'
    : DEFAULT_LOCALE;
}

export const detectBrowserLocale = detectLocale;

export function createTranslator(locale: Locale, catalog: LocaleCatalog = messages): Translator {
  return (key: MessageKey): string => {
    const localized = catalog[locale][key];
    if (typeof localized === 'string') return localized;

    const fallback = catalog[DEFAULT_LOCALE][key];
    return typeof fallback === 'string' ? fallback : key;
  };
}
