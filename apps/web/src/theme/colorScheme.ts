/**
 * Color schemes for the workbench.
 *
 * Pink is the first-visit accent for the neutral workbench. Existing saved
 * choices still take precedence, and only explicit choices are persisted.
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

export const DEFAULT_COLOR_SCHEME: ColorScheme = 'pink';

export const colorSchemeOptions: readonly ColorSchemeOption[] = [
  { id: 'green', preview: '#23834a', tone: 'chromatic' },
  { id: 'purple', preview: '#7c3aed', tone: 'chromatic' },
  { id: 'pink', preview: '#f077af', tone: 'chromatic' },
  { id: 'white', preview: '#e8e8e8', tone: 'monochrome' },
  { id: 'black', preview: '#1a1a1a', tone: 'monochrome' },
];

export const COLOR_SCHEME_IDS: readonly ColorScheme[] = colorSchemeOptions.map((option) => option.id);

export function isColorScheme(value: unknown): value is ColorScheme {
  return typeof value === 'string' && (COLOR_SCHEMES as readonly string[]).includes(value);
}

export function resolveColorScheme(value: unknown): ColorScheme {
  return isColorScheme(value) ? value : DEFAULT_COLOR_SCHEME;
}
