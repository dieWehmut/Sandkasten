import { describe, expect, test, vi } from 'vitest';
import {
  COLOR_SCHEME_STORAGE_KEY,
  useColorScheme,
  type ColorSchemeStorage,
} from '../src/composables/useColorScheme';
import {
  COLOR_SCHEME_IDS,
  DEFAULT_COLOR_SCHEME,
  isColorScheme,
  pickRandomColorScheme,
  resolveColorScheme,
  RANDOM_COLOR_SCHEME_IDS,
} from '../src/theme/colorScheme';

function createStorage(saved?: string) {
  return {
    getItem: vi.fn<(key: string) => string | null>(() => saved ?? null),
    setItem: vi.fn<(key: string, value: string) => void>(),
  } satisfies ColorSchemeStorage;
}

function createRoot() {
  const attributes = new Map<string, string>();
  return {
    setAttribute: vi.fn((name: string, value: string) => {
      attributes.set(name, value);
    }),
    attributes,
  };
}

describe('color scheme catalog', () => {
  test('exposes the five supported schemes with green as the default', () => {
    expect(COLOR_SCHEME_IDS).toEqual(['green', 'purple', 'pink', 'white', 'black']);
    expect(DEFAULT_COLOR_SCHEME).toBe('green');
  });

  test('keeps monochrome schemes out of the random rotation', () => {
    expect(RANDOM_COLOR_SCHEME_IDS).toEqual(['green', 'purple', 'pink']);
  });

  test('recognizes only supported scheme values', () => {
    expect(isColorScheme('green')).toBe(true);
    expect(isColorScheme('purple')).toBe(true);
    expect(isColorScheme('blue')).toBe(false);
    expect(isColorScheme(null)).toBe(false);
    expect(resolveColorScheme('nope')).toBe('green');
    expect(resolveColorScheme('pink')).toBe('pink');
  });

  test('picks a chromatic scheme from an injected random source', () => {
    expect(pickRandomColorScheme(() => 0)).toBe('green');
    expect(pickRandomColorScheme(() => 0.5)).toBe('purple');
    expect(pickRandomColorScheme(() => 0.999999)).toBe('pink');
  });
});

describe('useColorScheme', () => {
  test('applies a randomized chromatic scheme on a first visit without persisting it', () => {
    const root = createRoot();
    const storage = createStorage();

    const controller = useColorScheme({ root, storage, random: () => 0.5 });

    expect(controller.colorScheme.value).toBe('purple');
    expect(controller.hasExplicitPreference.value).toBe(false);
    expect(root.attributes.get('data-color-scheme')).toBe('purple');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  test('restores a stored scheme and persists later user changes', () => {
    const root = createRoot();
    const storage = createStorage('pink');

    const controller = useColorScheme({ root, storage, random: () => 0 });
    expect(controller.colorScheme.value).toBe('pink');
    expect(controller.hasExplicitPreference.value).toBe(true);

    controller.setColorScheme('black');

    expect(controller.colorScheme.value).toBe('black');
    expect(root.attributes.get('data-color-scheme')).toBe('black');
    expect(storage.setItem).toHaveBeenCalledWith(COLOR_SCHEME_STORAGE_KEY, 'black');
  });

  test('ignores unsupported stored values and falls back to the random rotation', () => {
    const root = createRoot();
    const storage = createStorage('chartreuse');

    const controller = useColorScheme({ root, storage, random: () => 0 });

    expect(controller.colorScheme.value).toBe('green');
    expect(controller.hasExplicitPreference.value).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  test('keeps the visible scheme when storage rejects a write', () => {
    const root = createRoot();
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new Error('quota exceeded');
      }),
    } satisfies ColorSchemeStorage;

    const controller = useColorScheme({ root, storage, random: () => 0 });

    expect(() => controller.setColorScheme('white')).not.toThrow();
    expect(controller.colorScheme.value).toBe('white');
    expect(root.attributes.get('data-color-scheme')).toBe('white');
  });

  test('exposes the ordered scheme list for the picker', () => {
    const controller = useColorScheme({ root: createRoot(), storage: createStorage(), random: () => 0 });
    expect(controller.options.value).toEqual(['green', 'purple', 'pink', 'white', 'black']);
  });
});
