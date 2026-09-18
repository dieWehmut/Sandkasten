import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
  resolveColorScheme,
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

  test('recognizes only supported scheme values', () => {
    expect(isColorScheme('green')).toBe(true);
    expect(isColorScheme('purple')).toBe(true);
    expect(isColorScheme('blue')).toBe(false);
    expect(isColorScheme(null)).toBe(false);
    expect(resolveColorScheme('nope')).toBe('green');
    expect(resolveColorScheme('pink')).toBe('pink');
  });

  test('keeps the focus and selection tokens derived from the active accent', () => {
    const schemes = readFileSync(resolve(import.meta.dirname, '../src/styles/schemes.css'), 'utf8');
    expect(schemes).toMatch(/--selection:\s*color-mix\(in srgb, var\(--accent\)/);
    expect(schemes).toMatch(/--focus-ring:\s*color-mix\(in srgb, var\(--accent\)/);
  });
});

describe('useColorScheme', () => {
  test('applies green on a first visit without persisting it', () => {
    const root = createRoot();
    const storage = createStorage();

    const controller = useColorScheme({ root, storage });

    expect(controller.colorScheme.value).toBe('green');
    expect(controller.hasExplicitPreference.value).toBe(false);
    expect(root.attributes.get('data-color-scheme')).toBe('green');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  test('restores a stored scheme and persists later user changes', () => {
    const root = createRoot();
    const storage = createStorage('pink');

    const controller = useColorScheme({ root, storage });
    expect(controller.colorScheme.value).toBe('pink');
    expect(controller.hasExplicitPreference.value).toBe(true);

    controller.setColorScheme('black');

    expect(controller.colorScheme.value).toBe('black');
    expect(root.attributes.get('data-color-scheme')).toBe('black');
    expect(storage.setItem).toHaveBeenCalledWith(COLOR_SCHEME_STORAGE_KEY, 'black');
  });

  test('ignores unsupported stored values and falls back to green', () => {
    const root = createRoot();
    const storage = createStorage('chartreuse');

    const controller = useColorScheme({ root, storage });

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

    const controller = useColorScheme({ root, storage });

    expect(() => controller.setColorScheme('white')).not.toThrow();
    expect(controller.colorScheme.value).toBe('white');
    expect(root.attributes.get('data-color-scheme')).toBe('white');
  });

  test('exposes the ordered scheme list for the picker', () => {
    const controller = useColorScheme({ root: createRoot(), storage: createStorage() });
    expect(controller.options.value).toEqual(['green', 'purple', 'pink', 'white', 'black']);
  });
});
