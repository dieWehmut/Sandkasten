import { computed, readonly, ref, type ComputedRef, type Ref } from 'vue';

export type Theme = 'light' | 'dark';

export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ThemeMediaQuery {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: (event: Pick<MediaQueryListEvent, 'matches'>) => void): void;
  removeEventListener(type: 'change', listener: (event: Pick<MediaQueryListEvent, 'matches'>) => void): void;
}

interface ThemeEnvironment {
  root?: HTMLElement;
  storage?: ThemeStorage;
  mediaQuery?: ThemeMediaQuery;
}

export interface ThemeController {
  theme: Readonly<Ref<Theme>>;
  hasExplicitPreference: Readonly<Ref<boolean>>;
  toggleLabel: ComputedRef<string>;
  setTheme(theme: Theme): void;
  toggleTheme(): void;
  dispose(): void;
}

const STORAGE_KEY = 'sandkasten-theme';

function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark';
}

function browserStorage(): ThemeStorage | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function browserMediaQuery(): ThemeMediaQuery | undefined {
  if (typeof window === 'undefined' || !window.matchMedia) return undefined;
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  return {
    get matches() { return query.matches; },
    addEventListener: (_type, listener) => query.addEventListener('change', listener as (event: MediaQueryListEvent) => void),
    removeEventListener: (_type, listener) => query.removeEventListener('change', listener as (event: MediaQueryListEvent) => void),
  };
}

export function useTheme(environment: ThemeEnvironment = {}): ThemeController {
  const root = environment.root ?? (typeof document === 'undefined' ? undefined : document.documentElement);
  const storage = environment.storage ?? browserStorage();
  const mediaQuery = environment.mediaQuery ?? browserMediaQuery();
  let storedTheme: string | null = null;

  try {
    storedTheme = storage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    storedTheme = null;
  }

  const explicitTheme = isTheme(storedTheme) ? storedTheme : undefined;
  const theme = ref<Theme>(explicitTheme ?? (mediaQuery?.matches ? 'dark' : 'light'));
  const hasExplicitPreference = ref(Boolean(explicitTheme));
  const toggleLabel = computed(() => `Use ${theme.value === 'light' ? 'dark' : 'light'} theme`);

  function applyTheme(nextTheme: Theme): void {
    theme.value = nextTheme;
    if (!root) return;
    root.dataset.theme = nextTheme;
    root.style.colorScheme = nextTheme;
  }

  function setTheme(nextTheme: Theme): void {
    hasExplicitPreference.value = true;
    applyTheme(nextTheme);
    try {
      storage?.setItem(STORAGE_KEY, nextTheme);
    } catch {
      // A blocked storage backend should not prevent the visible theme change.
    }
  }

  function toggleTheme(): void {
    setTheme(theme.value === 'light' ? 'dark' : 'light');
  }

  function handleSystemTheme(event: Pick<MediaQueryListEvent, 'matches'>): void {
    if (!hasExplicitPreference.value) applyTheme(event.matches ? 'dark' : 'light');
  }

  applyTheme(theme.value);
  mediaQuery?.addEventListener('change', handleSystemTheme);

  return {
    theme: readonly(theme),
    hasExplicitPreference: readonly(hasExplicitPreference),
    toggleLabel,
    setTheme,
    toggleTheme,
    dispose: () => mediaQuery?.removeEventListener('change', handleSystemTheme),
  };
}
