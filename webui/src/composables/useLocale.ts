import { readonly, ref, type Ref } from 'vue';
import {
  createTranslator,
  detectLocale,
  isLocale,
  LOCALE_STORAGE_KEY,
  type Locale,
  type Translator,
} from '../i18n/locale';

export interface LocaleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface LocaleNavigator {
  readonly language?: string;
}

export interface LocaleRoot {
  lang: string;
}

export interface LocaleDocument {
  readonly documentElement?: LocaleRoot;
}

export interface LocaleEnvironment {
  root?: LocaleRoot;
  storage?: LocaleStorage;
  navigator?: LocaleNavigator;
  document?: LocaleDocument;
}

export interface LocaleController {
  locale: Readonly<Ref<Locale>>;
  hasExplicitPreference: Readonly<Ref<boolean>>;
  t: Translator;
  translate: Translator;
  setLocale(locale: Locale): void;
}

function browserStorage(): LocaleStorage | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function browserNavigator(): LocaleNavigator | undefined {
  if (typeof window === 'undefined' || !window.navigator) return undefined;
  return window.navigator;
}

function browserRoot(): LocaleRoot | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.documentElement;
}

export function useLocale(environment: LocaleEnvironment = {}): LocaleController {
  const root = environment.root ?? environment.document?.documentElement ?? browserRoot();
  const storage = environment.storage ?? browserStorage();
  const navigator = environment.navigator ?? browserNavigator();

  let storedLocale: string | null = null;
  try {
    storedLocale = storage?.getItem(LOCALE_STORAGE_KEY) ?? null;
  } catch {
    storedLocale = null;
  }

  const explicitLocale = isLocale(storedLocale) ? storedLocale : undefined;
  const locale = ref<Locale>(explicitLocale ?? detectLocale(navigator?.language));
  const hasExplicitPreference = ref(Boolean(explicitLocale));

  function applyLocale(nextLocale: Locale): void {
    locale.value = nextLocale;
    if (root) root.lang = nextLocale;
  }

  function setLocale(nextLocale: Locale): void {
    hasExplicitPreference.value = true;
    applyLocale(nextLocale);
    try {
      storage?.setItem(LOCALE_STORAGE_KEY, nextLocale);
    } catch {
      // A blocked storage backend should not prevent the visible locale change.
    }
  }

  const t: Translator = (key) => createTranslator(locale.value)(key);

  applyLocale(locale.value);

  return {
    locale: readonly(locale),
    hasExplicitPreference: readonly(hasExplicitPreference),
    t,
    translate: t,
    setLocale,
  };
}
