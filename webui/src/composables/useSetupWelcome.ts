import { readonly, ref, type Ref } from 'vue';

export const SETUP_WELCOME_STORAGE_KEY = 'sandkasten-install-guide-seen';

export interface SetupWelcomeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface SetupWelcomeEnvironment {
  storage?: SetupWelcomeStorage;
}

export interface SetupWelcomeController {
  seen: Readonly<Ref<boolean>>;
  isGuideOpen: Readonly<Ref<boolean>>;
  dismiss(): void;
  reopen(): void;
}

function browserStorage(): SetupWelcomeStorage | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function useSetupWelcome(environment: SetupWelcomeEnvironment = {}): SetupWelcomeController {
  const storage = environment.storage ?? browserStorage();
  let hasSeenGuide = false;

  try {
    hasSeenGuide = storage?.getItem(SETUP_WELCOME_STORAGE_KEY) === 'true';
  } catch {
    hasSeenGuide = false;
  }

  const seen = ref(hasSeenGuide);
  const isGuideOpen = ref(!hasSeenGuide);

  function dismiss(): void {
    seen.value = true;
    isGuideOpen.value = false;
    try {
      storage?.setItem(SETUP_WELCOME_STORAGE_KEY, 'true');
    } catch {
      // Storage can be blocked; the current session should still enter the workbench.
    }
  }

  function reopen(): void {
    isGuideOpen.value = true;
  }

  return {
    seen: readonly(seen),
    isGuideOpen: readonly(isGuideOpen),
    dismiss,
    reopen,
  };
}
