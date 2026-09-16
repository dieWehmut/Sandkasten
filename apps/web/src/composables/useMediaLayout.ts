import { computed, readonly, ref, type ComputedRef, type Ref } from 'vue';

export type LayoutMode = 'desktop' | 'tablet' | 'mobile';

export interface LayoutMediaQuery {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
}

interface MediaLayoutEnvironment {
  desktopQuery?: LayoutMediaQuery;
  mobileQuery?: LayoutMediaQuery;
}

export interface MediaLayoutController {
  mode: Readonly<Ref<LayoutMode>>;
  isDesktop: ComputedRef<boolean>;
  isCompact: ComputedRef<boolean>;
  isMobile: ComputedRef<boolean>;
  dispose(): void;
}

function browserQuery(value: string): LayoutMediaQuery | undefined {
  if (typeof window === 'undefined' || !window.matchMedia) return undefined;
  const query = window.matchMedia(value);
  const listeners = new Map<() => void, (event: MediaQueryListEvent) => void>();
  return {
    get matches() { return query.matches; },
    addEventListener: (_type, listener) => {
      const adapter = () => listener();
      listeners.set(listener, adapter);
      query.addEventListener('change', adapter);
    },
    removeEventListener: (_type, listener) => {
      const adapter = listeners.get(listener);
      if (adapter) query.removeEventListener('change', adapter);
      listeners.delete(listener);
    },
  };
}

export function useMediaLayout(environment: MediaLayoutEnvironment = {}): MediaLayoutController {
  const desktopQuery = environment.desktopQuery ?? browserQuery('(min-width: 1200px)');
  const mobileQuery = environment.mobileQuery ?? browserQuery('(max-width: 767px)');

  function resolveMode(): LayoutMode {
    if (desktopQuery?.matches ?? (!desktopQuery && !mobileQuery)) return 'desktop';
    return mobileQuery?.matches ? 'mobile' : 'tablet';
  }

  const mode = ref<LayoutMode>(resolveMode());
  const updateMode = () => { mode.value = resolveMode(); };
  desktopQuery?.addEventListener('change', updateMode);
  mobileQuery?.addEventListener('change', updateMode);

  return {
    mode: readonly(mode),
    isDesktop: computed(() => mode.value === 'desktop'),
    isCompact: computed(() => mode.value !== 'desktop'),
    isMobile: computed(() => mode.value === 'mobile'),
    dispose() {
      desktopQuery?.removeEventListener('change', updateMode);
      mobileQuery?.removeEventListener('change', updateMode);
    },
  };
}
