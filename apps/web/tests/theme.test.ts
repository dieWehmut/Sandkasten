import { mount } from '@vue/test-utils';
import { describe, expect, test, vi } from 'vitest';
import HeaderActions from '../src/components/HeaderActions.vue';
import { useTheme, type ThemeMediaQuery, type ThemeStorage } from '../src/composables/useTheme';

function createStorage(saved?: string) {
  const storage = {
    getItem: vi.fn<(key: string) => string | null>(() => saved ?? null),
    setItem: vi.fn<(key: string, value: string) => void>(),
  } satisfies ThemeStorage;
  return storage;
}

function createMediaQuery(matches: boolean) {
  let currentMatches = matches;
  const listeners = new Set<(event: Pick<MediaQueryListEvent, 'matches'>) => void>();
  const mediaQuery: ThemeMediaQuery = {
    get matches() { return currentMatches; },
    addEventListener: vi.fn((_type, listener) => listeners.add(listener)),
    removeEventListener: vi.fn((_type, listener) => listeners.delete(listener)),
  };
  return {
    mediaQuery,
    change(nextMatches: boolean) {
      currentMatches = nextMatches;
      listeners.forEach((listener) => listener({ matches: nextMatches }));
    },
  };
}

describe('useTheme', () => {
  test('honors the system theme initially without persisting an implicit choice', () => {
    const root = document.createElement('html');
    const storage = createStorage();
    const { mediaQuery } = createMediaQuery(true);

    const controller = useTheme({ root, storage, mediaQuery });

    expect(controller.theme.value).toBe('dark');
    expect(controller.hasExplicitPreference.value).toBe(false);
    expect(root.dataset.theme).toBe('dark');
    expect(root.style.colorScheme).toBe('dark');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  test('restores a valid explicit preference and persists later user changes', () => {
    const root = document.createElement('html');
    const storage = createStorage('light');
    const { mediaQuery } = createMediaQuery(true);

    const controller = useTheme({ root, storage, mediaQuery });
    controller.toggleTheme();

    expect(controller.theme.value).toBe('dark');
    expect(controller.hasExplicitPreference.value).toBe(true);
    expect(controller.toggleLabel.value).toBe('Use light theme');
    expect(root.dataset.theme).toBe('dark');
    expect(storage.setItem).toHaveBeenCalledWith('sandkasten-theme', 'dark');
  });

  test('follows system changes only until the user makes an explicit choice', () => {
    const root = document.createElement('html');
    const storage = createStorage();
    const system = createMediaQuery(false);
    const controller = useTheme({ root, storage, mediaQuery: system.mediaQuery });

    system.change(true);
    expect(controller.theme.value).toBe('dark');

    controller.setTheme('light');
    system.change(false);
    system.change(true);

    expect(controller.theme.value).toBe('light');
    expect(root.dataset.theme).toBe('light');
    expect(storage.setItem).toHaveBeenCalledOnce();

    controller.dispose();
    expect(system.mediaQuery.removeEventListener).toHaveBeenCalledOnce();
  });

  test('gives the theme action a specific accessible target', async () => {
    const actions = mount(HeaderActions, { props: { theme: 'light' } });

    await actions.get('button[aria-label="Use dark theme"]').trigger('click');

    expect(actions.emitted('toggleTheme')).toHaveLength(1);
  });
});
