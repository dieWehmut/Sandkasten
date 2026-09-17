import { computed, readonly, ref, type ComputedRef, type Ref } from 'vue';
import {
  COLOR_SCHEME_IDS,
  pickRandomColorScheme,
  resolveColorScheme,
  type ColorScheme,
} from '../theme/colorScheme';

export const COLOR_SCHEME_STORAGE_KEY = 'sandkasten-color-scheme';

export interface ColorSchemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ColorSchemeRoot {
  setAttribute(name: string, value: string): void;
}

interface ColorSchemeEnvironment {
  root?: ColorSchemeRoot;
  storage?: ColorSchemeStorage;
  random?: () => number;
}

export interface ColorSchemeController {
  colorScheme: Readonly<Ref<ColorScheme>>;
  hasExplicitPreference: Readonly<Ref<boolean>>;
  options: ComputedRef<readonly ColorScheme[]>;
  setColorScheme(scheme: ColorScheme): void;
}

function browserStorage(): ColorSchemeStorage | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function browserRoot(): ColorSchemeRoot | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.documentElement;
}

export function useColorScheme(environment: ColorSchemeEnvironment = {}): ColorSchemeController {
  const root = environment.root ?? browserRoot();
  const storage = environment.storage ?? browserStorage();
  let stored: string | null = null;

  try {
    stored = storage?.getItem(COLOR_SCHEME_STORAGE_KEY) ?? null;
  } catch {
    stored = null;
  }

  const explicitScheme: ColorScheme | undefined = stored === null ? undefined : (resolveColorScheme(stored) === stored ? stored : undefined);
  const initialScheme = explicitScheme ?? pickRandomColorScheme(environment.random);
  const colorScheme = ref<ColorScheme>(initialScheme);
  const hasExplicitPreference = ref(Boolean(explicitScheme));

  function applyColorScheme(nextScheme: ColorScheme): void {
    colorScheme.value = nextScheme;
    root?.setAttribute('data-color-scheme', nextScheme);
  }

  function setColorScheme(nextScheme: ColorScheme): void {
    hasExplicitPreference.value = true;
    applyColorScheme(nextScheme);
    try {
      storage?.setItem(COLOR_SCHEME_STORAGE_KEY, nextScheme);
    } catch {
      // A blocked storage backend must not prevent the visible scheme change.
    }
  }

  applyColorScheme(colorScheme.value);

  return {
    colorScheme: readonly(colorScheme),
    hasExplicitPreference: readonly(hasExplicitPreference),
    options: computed(() => COLOR_SCHEME_IDS),
    setColorScheme,
  };
}
