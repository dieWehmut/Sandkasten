import { ref } from 'vue';
import { describe, expect, test } from 'vitest';
import { useAppearance } from '../src/composables/useAppearance';
import type { Theme } from '../src/composables/useTheme';
import type { ColorScheme } from '../src/theme/colorScheme';

function setup(saved?: string) {
  const values = new Map<string, string>(saved ? [['sandkasten-appearance', saved]] : []);
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const root = document.createElement('html');
  const theme = ref<Theme>('light');
  const scheme = ref<ColorScheme>('pink');
  return { values, storage, root, theme, scheme, controller: useAppearance(theme, scheme, { root, storage }) };
}

describe('appearance overrides', () => {
  test('reports which colors the active theme overrides, for the settings marker', () => {
    const ctx = setup();
    expect(ctx.controller.customized.value).toEqual({ accent: false, background: false, foreground: false });

    ctx.controller.setColor('accent', '#123456');
    expect(ctx.controller.customized.value).toEqual({ accent: true, background: false, foreground: false });

    // The marker is per theme: the other theme has not been touched.
    ctx.theme.value = 'dark';
    expect(ctx.controller.customized.value).toEqual({ accent: false, background: false, foreground: false });
    ctx.theme.value = 'light';

    ctx.controller.resetColors();
    expect(ctx.controller.customized.value).toEqual({ accent: false, background: false, foreground: false });
  });

  test('applies colors immediately, keeps each theme independent and restores saved overrides', () => {
    const ctx = setup();
    ctx.controller.setColor('background', '#f0e8ff');
    ctx.controller.setColor('foreground', '#222033');
    ctx.controller.setColor('accent', '#000000');
    expect(ctx.root.style.getPropertyValue('--surface')).toBe('#f0e8ff');
    expect(ctx.root.style.getPropertyValue('--text')).toBe('#222033');
    expect(ctx.root.style.getPropertyValue('--accent-fill')).toBe('#000000');
    expect(ctx.root.style.getPropertyValue('--on-accent')).toBe('#ffffff');
    ctx.theme.value = 'dark';
    expect(ctx.root.style.getPropertyValue('--surface')).toBe('');
    ctx.controller.setColor('background', '#202030');
    ctx.controller.setColor('accent', '#ffffff');
    expect(ctx.root.style.getPropertyValue('--on-accent')).toBe('#000000');
    ctx.theme.value = 'light';
    expect(ctx.root.style.getPropertyValue('--surface')).toBe('#f0e8ff');
    const saved = ctx.values.get('sandkasten-appearance');
    const restored = setup(saved);
    expect(restored.controller.colors.value.background).toBe('#f0e8ff');
    restored.theme.value = 'dark';
    expect(restored.controller.colors.value.background).toBe('#202030');
    ctx.controller.dispose(); restored.controller.dispose();
  });

  test('ignores invalid colors and reset removes inline overrides for only the active theme', () => {
    const ctx = setup('{"light":{"background":"url(bad)","accent":"#123456"},"dark":{"background":"#202030"}}');
    expect(ctx.controller.colors.value.background).toBe('#ffffff');
    expect(ctx.controller.setColor('background', 'red')).toBe(false);
    expect(ctx.controller.colors.value.background).toBe('#ffffff');
    ctx.controller.resetColors();
    expect(ctx.root.style.getPropertyValue('--accent-fill')).toBe('');
    ctx.theme.value = 'dark';
    expect(ctx.controller.colors.value.background).toBe('#202030');
    ctx.controller.dispose();
  });

  test('keeps text and accent tokens readable on a customized surface', () => {
    const ctx = setup();
    ctx.controller.setColor('background', '#000000');
    ctx.controller.setColor('foreground', '#000000');
    expect(ctx.root.style.getPropertyValue('--text')).toBe('#ffffff');
    expect(ctx.root.style.getPropertyValue('--accent')).not.toBe('#b12a69');
    ctx.controller.setColor('accent', '#ffffff');
    expect(ctx.root.style.getPropertyValue('--accent')).toBe('#ffffff');
    expect(ctx.root.style.getPropertyValue('--on-accent')).toBe('#000000');
    ctx.controller.dispose();
  });
});
