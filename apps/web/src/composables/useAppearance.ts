import { computed, ref, watch, type Ref } from 'vue';
import type { Theme, ThemeStorage } from './useTheme';
import type { ColorScheme } from '../theme/colorScheme';

export type AppearanceColor = 'accent' | 'background' | 'foreground';
export interface AppearanceColors { accent: string; background: string; foreground: string }
type Overrides = Record<Theme, Partial<AppearanceColors>>;
const STORAGE_KEY = 'sandkasten-appearance';
const colorKeys: AppearanceColor[] = ['accent', 'background', 'foreground'];
const fills: Record<ColorScheme, [string, string]> = {
  pink: ['#f077af', '#f077af'], green: ['#176235', '#63d58a'],
  purple: ['#5b21b6', '#b79bfd'], white: ['#4f4f4f', '#ffffff'], black: ['#000000', '#9a9a9a'],
};
const validColor = (value: unknown): value is string => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
function rgb(value: string): number[] { return [1, 3, 5].map((start) => parseInt(value.slice(start, start + 2), 16)); }
function mix(a: string, b: string, weight: number): string {
  const other = rgb(b);
  return `#${rgb(a).map((part, index) => Math.round(part * (1 - weight) + other[index] * weight).toString(16).padStart(2, '0')).join('')}`;
}
function luminance(color: string): number {
  const [r, g, b] = rgb(color).map((part) => { const value = part / 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const first = luminance(a); const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
function readable(color: string, background: string): string {
  if (contrast(color, background) >= 4.5) return color;
  const target = contrast('#ffffff', background) > contrast('#000000', background) ? '#ffffff' : '#000000';
  // Preserve hue when possible, but use a fully contrasting endpoint for equal colors.
  if (color === background) return target;
  for (let step = 1; step <= 20; step++) {
    const adjusted = mix(color, target, step / 20);
    if (contrast(adjusted, background) >= 4.5) return adjusted;
  }
  return target;
}

export function useAppearance(theme: Readonly<Ref<Theme>>, scheme: Readonly<Ref<ColorScheme>>, environment: { root?: HTMLElement; storage?: ThemeStorage } = {}) {
  const root = environment.root ?? document.documentElement;
  let storage = environment.storage;
  try { storage ??= window.localStorage; } catch { /* Storage may be blocked. */ }
  const overrides = ref<Overrides>({ light: {}, dark: {} });
  try {
    const stored = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '{}');
    for (const mode of ['light', 'dark'] as const) {
      for (const key of colorKeys) {
        if (validColor(stored?.[mode]?.[key])) overrides.value[mode][key] = stored[mode][key].toLowerCase();
      }
    }
  } catch { /* Invalid or unavailable preferences fall back to the theme. */ }
  const colors = computed<AppearanceColors>(() => ({
    // The defaults mirror the pure token surfaces so the settings swatches
    // preview exactly what the workbench renders.
    background: theme.value === 'light' ? '#ffffff' : '#000000',
    foreground: theme.value === 'light' ? '#1a1c1f' : '#f1f2f1',
    accent: fills[scheme.value][theme.value === 'light' ? 0 : 1],
    ...overrides.value[theme.value],
  }));
  const applied = new Set<string>();
  function apply(): void {
    for (const key of applied) root.style.removeProperty(key);
    applied.clear();
    const custom = overrides.value[theme.value];
    if (!Object.keys(custom).length) return;
    const { background, foreground, accent } = colors.value;
    const text = readable(foreground, background);
    const set = (key: string, value: string) => { applied.add(key); root.style.setProperty(key, value); };
    if (custom.background || custom.foreground) {
      set('--surface', background);
      set('--canvas', mix(background, text, 0.045));
      set('--chrome', mix(background, text, 0.045));
      set('--surface-subtle', mix(background, text, 0.035));
      set('--surface-raised', mix(background, text, 0.015));
      set('--text', text);
      set('--text-muted', readable(mix(text, background, 0.25), background));
      set('--text-faint', readable(mix(text, background, 0.4), background));
      set('--border', mix(background, text, 0.12));
      set('--border-strong', mix(background, text, 0.25));
    }
    const soft = mix(background, accent, 0.12);
    set('--accent', readable(accent, background));
    set('--accent-strong', readable(accent, soft));
    set('--accent-soft', soft);
    set('--accent-fill', accent);
    set('--on-accent', contrast('#ffffff', accent) > contrast('#000000', accent) ? '#ffffff' : '#000000');
  }
  function persist(): void { try { storage?.setItem(STORAGE_KEY, JSON.stringify(overrides.value)); } catch { /* Apply even without storage. */ } }
  function setColor(key: AppearanceColor, value: string): boolean {
    if (!colorKeys.includes(key) || !validColor(value)) return false;
    overrides.value[theme.value] = { ...overrides.value[theme.value], [key]: value.toLowerCase() };
    persist(); return true;
  }
  function resetColors(): void { overrides.value[theme.value] = {}; persist(); }
  const dispose = watch([theme, scheme, overrides], apply, { deep: true, immediate: true, flush: 'sync' });
  return { colors, setColor, resetColors, dispose };
}
