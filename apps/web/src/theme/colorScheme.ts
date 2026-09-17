/**
 * Color schemes for the workbench.
 *
 * The default `green` scheme keeps the token values the interface shipped with,
 * so switching schemes is purely additive: every scheme must satisfy the same
 * contrast contract the green palette already met.
 */

export const COLOR_SCHEMES = ['green', 'purple', 'pink', 'white', 'black'] as const;

export type ColorScheme = typeof COLOR_SCHEMES[number];
export type ColorSchemeTone = 'chromatic' | 'monochrome';

export interface ColorSchemeOption {
  id: ColorScheme;
  /** Swatch color shown in the picker; independent of the active theme. */
  preview: string;
  tone: ColorSchemeTone;
}

export const DEFAULT_COLOR_SCHEME: ColorScheme = 'green';

/**
 * Only chromatic schemes join the first-visit rotation. The monochrome schemes
 * stay opt-in so a fresh visit never lands on a gray interface by accident.
 */
export const colorSchemeOptions: readonly ColorSchemeOption[] = [
  { id: 'green', preview: '#23834a', tone: 'chromatic' },
  { id: 'purple', preview: '#7c3aed', tone: 'chromatic' },
  { id: 'pink', preview: '#db2777', tone: 'chromatic' },
  { id: 'white', preview: '#e8e8e8', tone: 'monochrome' },
  { id: 'black', preview: '#1a1a1a', tone: 'monochrome' },
];

export const COLOR_SCHEME_IDS: readonly ColorScheme[] = colorSchemeOptions.map((option) => option.id);

export const RANDOM_COLOR_SCHEME_IDS: readonly ColorScheme[] = colorSchemeOptions
  .filter((option) => option.tone === 'chromatic')
  .map((option) => option.id);

export function isColorScheme(value: unknown): value is ColorScheme {
  return typeof value === 'string' && (COLOR_SCHEMES as readonly string[]).includes(value);
}

export function resolveColorScheme(value: unknown): ColorScheme {
  return isColorScheme(value) ? value : DEFAULT_COLOR_SCHEME;
}

/** Picks a chromatic scheme for a first visit without persisting the choice. */
export function pickRandomColorScheme(random: () => number = Math.random): ColorScheme {
  const index = Math.floor(random() * RANDOM_COLOR_SCHEME_IDS.length);
  return RANDOM_COLOR_SCHEME_IDS[Math.min(Math.max(index, 0), RANDOM_COLOR_SCHEME_IDS.length - 1)] ?? DEFAULT_COLOR_SCHEME;
}
