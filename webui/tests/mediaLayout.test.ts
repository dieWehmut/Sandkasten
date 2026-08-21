import { describe, expect, test, vi } from 'vitest';
import { useMediaLayout, type LayoutMediaQuery } from '../src/composables/useMediaLayout';

function createQuery(matches: boolean) {
  let currentMatches = matches;
  const listeners = new Set<() => void>();
  const query: LayoutMediaQuery = {
    get matches() { return currentMatches; },
    addEventListener: vi.fn((_type, listener) => listeners.add(listener)),
    removeEventListener: vi.fn((_type, listener) => listeners.delete(listener)),
  };
  return {
    query,
    change(nextMatches: boolean) {
      currentMatches = nextMatches;
      listeners.forEach((listener) => listener());
    },
  };
}

describe('useMediaLayout', () => {
  test('maps desktop, tablet, and mobile media tracks without overlap', () => {
    const desktop = createQuery(true);
    const mobile = createQuery(false);
    const layout = useMediaLayout({ desktopQuery: desktop.query, mobileQuery: mobile.query });

    expect(layout.mode.value).toBe('desktop');
    expect(layout.isDesktop.value).toBe(true);

    desktop.change(false);
    expect(layout.mode.value).toBe('tablet');

    mobile.change(true);
    expect(layout.mode.value).toBe('mobile');
    expect(layout.isCompact.value).toBe(true);

    layout.dispose();
    expect(desktop.query.removeEventListener).toHaveBeenCalledOnce();
    expect(mobile.query.removeEventListener).toHaveBeenCalledOnce();
  });
});
