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
  test('keeps the muted and faint roles readable on the shaded surfaces too', () => {
    // The sidebar, tab strip, and status bar paint on --chrome, which is darker
    // than --surface in the light theme. Resolving the muted roles against
    // --surface alone left them at 4.46:1 on those rows — just under AA.
    const ctx = setup();
    ctx.controller.setColor('background', '#ffffff');
    ctx.controller.setColor('foreground', '#eeeeee');
    const rgb = (hex: string) => [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
    const luminance = (hex: string) => {
      const [r, g, b] = rgb(hex).map((channel) => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: string, b: string) => {
      const [first, second] = [luminance(a), luminance(b)].sort((left, right) => right - left);
      return (first + 0.05) / (second + 0.05);
    };
    const surface = ctx.root.style.getPropertyValue('--surface');
    const chrome = ctx.root.style.getPropertyValue('--chrome');
    for (const token of ['--text-muted', '--text-faint']) {
      const value = ctx.root.style.getPropertyValue(token);
      expect(value).toMatch(/^#[0-9a-f]{6}$/);
      expect(contrast(value, surface)).toBeGreaterThanOrEqual(4.5);
      // The shaded rows are the ones that used to fall short.
      expect(contrast(value, chrome)).toBeGreaterThanOrEqual(4.5);
    }
    ctx.controller.dispose();
  });

  test('keeps every resolved role readable for arbitrary user colours', () => {
    // The two tests above pin hand-picked colours. The resolver is the interesting
    // risk: `readableOn` has to satisfy several surfaces at once, and a user can
    // pick any colour. Sweep a deterministic grid plus the awkward cases —
    // foreground equal to the background, pure black, pure white, and mid greys
    // that leave the least contrast headroom — and require AA on every surface the
    // role is actually painted on.
    const rgb = (hex: string) => [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
    const luminance = (hex: string) => {
      const [r, g, b] = rgb(hex).map((channel) => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: string, b: string) => {
      const [first, second] = [luminance(a), luminance(b)].sort((left, right) => right - left);
      return (first + 0.05) / (second + 0.05);
    };

    const palette = ['#000000', '#ffffff', '#808080', '#eeeeee', '#0a0a0a', '#f077af', '#7f7f7f'];
    const grid: string[] = [...palette];
    for (let step = 0; step <= 5; step++) {
      const channel = Math.round((step / 5) * 255).toString(16).padStart(2, '0');
      grid.push(`#${channel}${channel}${channel}`);
    }

    // Every role the workbench paints text with, and the surfaces it lands on.
    const roles = ['--text', '--text-muted', '--text-faint', '--accent'] as const;
    let checked = 0;
    for (const background of grid) {
      for (const foreground of grid) {
        const ctx = setup();
        ctx.controller.setColor('background', background);
        ctx.controller.setColor('foreground', foreground);
        const surface = ctx.root.style.getPropertyValue('--surface');
        const chrome = ctx.root.style.getPropertyValue('--chrome');
        for (const role of roles) {
          const value = ctx.root.style.getPropertyValue(role);
          expect(value, `${role} is unset for ${foreground}/${background}`).toMatch(/^#[0-9a-f]{6}$/);
          // `--accent` is used as an icon/text colour on both surfaces.
          for (const painted of [surface, chrome]) {
            const ratio = contrast(value, painted);
            expect(
              ratio,
              `${role} ${value} on ${painted} for foreground ${foreground} / background ${background}`,
            ).toBeGreaterThanOrEqual(4.5);
          }
          checked += 1;
        }
        ctx.controller.dispose();
      }
    }
    // Guard against the sweep silently shrinking to nothing.
    expect(checked).toBeGreaterThan(300);
  });
});
