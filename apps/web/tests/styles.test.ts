import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const stylesRoot = resolve(import.meta.dirname, '../src/styles');

function style(name: string): string {
  return readFileSync(resolve(stylesRoot, name), 'utf8');
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) throw new Error(`Unsupported color: ${hex}`);
  return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16)) as [number, number, number];
}

function relativeLuminance(hex: string): number {
  return hexToRgb(hex)
    .map((channel) => channel / 255)
    .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

function token(theme: string, name: string): string {
  const match = theme.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6});`, 'i'));
  if (!match) throw new Error(`Missing ${name} token`);
  return match[1];
}

// Resolve the declarations used by these controls, including their dark-theme
// overrides. Contrast checks then follow the rendered foreground/background
// pair instead of assuming that an accent token always means a button fill.
function renderedColors(file: string, selectors: string[], theme: 'light' | 'dark', tokens: string) {
  const declarations = new Map<string, string>();
  const source = style(file).replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = Array.from(source.matchAll(/([^{}]+)\{([^{}]*)\}/g));
  for (const selector of selectors) {
    for (const activeSelector of [selector, ...(theme === 'dark' ? [`:root[data-theme="dark"] ${selector}`] : [])]) {
      for (const [, ruleSelectors, body] of rules) {
        if (!ruleSelectors.split(',').some((value) => value.trim() === activeSelector)) continue;
        for (const [, property, value] of body.matchAll(/(?:^|;)\s*(color|background):\s*([^;]+)/g)) {
          declarations.set(property, value.trim());
        }
      }
    }
  }
  function resolveColor(property: string): string {
    const value = declarations.get(property);
    if (!value) throw new Error(`Missing ${property} for ${selectors.join(' / ')}`);
    const variable = value.match(/^var\((--[a-z-]+)\)$/);
    if (variable) return token(tokens, variable[1]);
    if (/^#[0-9a-f]{3}$/i.test(value)) return `#${[...value.slice(1)].map((digit) => digit.repeat(2)).join('')}`;
    return value;
  }
  return [resolveColor('color'), resolveColor('background')] as const;
}

describe('workbench style boundaries', () => {
  test('keeps visual concerns in focused files', () => {
    for (const file of ['tokens.css', 'schemes.css', 'base.css', 'workbench.css', 'editor.css', 'output.css', 'sheets.css', 'ide.css']) {
      expect(style(file).trim().length, file).toBeGreaterThan(0);
    }
  });

  test('declares both token themes and reduced motion', () => {
    const tokens = style('tokens.css');
    const base = style('base.css');
    expect(tokens).toContain('[data-theme="dark"]');
    expect(tokens).toContain('--success:');
    expect(base).toContain('@media (prefers-reduced-motion: reduce)');
    expect(base).toContain('transition: none');
  });

  test('keeps primary and secondary text readable across content and chrome', () => {
    for (const theme of style('tokens.css').split(':root[data-theme="dark"]')) {
      for (const foreground of ['--text', '--text-muted']) {
        for (const background of ['--canvas', '--chrome', '--surface', '--surface-subtle', '--surface-raised']) {
          expect(contrastRatio(token(theme, foreground), token(theme, background)), `${foreground} on ${background}`)
            .toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  test('keeps semantic status text readable on its soft background', () => {
    for (const theme of style('tokens.css').split(':root[data-theme="dark"]')) {
      for (const state of ['success', 'warning', 'danger', 'info']) {
        expect(contrastRatio(token(theme, `--${state}`), token(theme, `--${state}-soft`)), state)
          .toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  test('the integrated title row matches the native overlay and stays draggable except for its controls', () => {
    const workbench = style('workbench.css');
    expect(workbench).toMatch(/\.workbench-app--integrated \{\s*--header-height: 40px;\s*\}/);
    expect(workbench).toMatch(/\.app-header--integrated \{[^}]*-webkit-app-region: drag;/s);
    expect(workbench).toMatch(/\.app-header--integrated button,[\s\S]*?-webkit-app-region: no-drag;/);
    expect(workbench).toContain('var(--window-controls-inset, 14px)');
    expect(workbench).toMatch(/\.desktop-menu__button\[aria-expanded="true"\]/);
  });

  test('uses the VS Code editing conventions without cloning them', () => {
    const ide = style('ide.css');
    expect(ide).toContain('--vscode-status-height: 22px');
    expect(ide).toMatch(/@media \(max-width: 1199px\) \{\s*\.ide-status__group--center \{\s*display: none;/);
  });

  test('defines stable desktop, tablet, and mobile tracks without gradients', () => {
    const combined = ['base.css', 'workbench.css', 'editor.css', 'output.css', 'sheets.css', 'ide.css']
      .map(style)
      .join('\n');
    const workbench = style('workbench.css');
    expect(workbench).toContain('grid-template-columns: 244px minmax(0, 1fr) 304px');
    expect(workbench).toContain('@media (max-width: 1199px)');
    expect(workbench).toContain('@media (max-width: 767px)');
    expect(combined).not.toMatch(/gradient\(/i);
  });

  test('keeps letter spacing neutral across the operational interface', () => {
    const combined = ['tokens.css', 'schemes.css', 'base.css', 'workbench.css', 'editor.css', 'output.css', 'sheets.css', 'ide.css']
      .map(style)
      .join('\n');
    const values = Array.from(combined.matchAll(/letter-spacing:\s*([^;]+);/g), (match) => match[1].trim());
    expect(new Set(values)).toEqual(new Set(['0']));
  });
});

const SCHEME_NAMES = ['green', 'purple', 'pink', 'white', 'black'] as const;

function schemeBlock(scheme: string, theme: 'light' | 'dark'): string {
  const source = style('schemes.css');
  const selector = theme === 'dark'
    ? `:root[data-theme="dark"][data-color-scheme="${scheme}"]`
    : `:root[data-color-scheme="${scheme}"]`;
  const start = source.indexOf(selector);
  if (start === -1) throw new Error(`Missing ${theme} block for ${scheme}`);
  const body = source.slice(start).split('{')[1];
  return body.split('}')[0] ?? '';
}

function lightBlock(scheme: string): string {
  return schemeBlock(scheme, 'light');
}

describe('color scheme palettes', () => {
  test('defines every supported scheme in both themes', () => {
    for (const scheme of SCHEME_NAMES) {
      for (const theme of ['light', 'dark'] as const) {
        const block = theme === 'light' ? lightBlock(scheme) : schemeBlock(scheme, 'dark');
        expect(block, `${scheme}/${theme}`).toContain('--accent:');
        expect(block, `${scheme}/${theme}`).toContain('--accent-strong:');
        expect(block, `${scheme}/${theme}`).toContain('--accent-soft:');
      }
    }
  });

  test('keeps every light scheme readable on the rendered surfaces', () => {
    const lightTokens = style('tokens.css').split(':root[data-theme="dark"]')[0];
    const surface = token(lightTokens, '--surface');
    const text = token(lightTokens, '--text');
    for (const scheme of SCHEME_NAMES) {
      const block = lightBlock(scheme);
      const accent = token(block, '--accent');
      const strong = token(block, '--accent-strong');
      const soft = token(block, '--accent-soft');
      expect(contrastRatio('#ffffff', strong), `${scheme} white on accent-strong`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(strong, soft), `${scheme} accent-strong on accent-soft`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(accent, surface), `${scheme} accent on surface`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(text, soft), `${scheme} text on accent-soft`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('keeps every dark scheme readable on the rendered surfaces', () => {
    const darkTokens = style('tokens.css').split(':root[data-theme="dark"]')[1];
    const surface = token(darkTokens, '--surface');
    const text = token(darkTokens, '--text');
    for (const scheme of SCHEME_NAMES) {
      const block = schemeBlock(scheme, 'dark');
      const accent = token(block, '--accent');
      const strong = token(block, '--accent-strong');
      const soft = token(block, '--accent-soft');
      expect(contrastRatio(surface, accent), `${scheme} surface on accent`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(surface, strong), `${scheme} surface on accent-strong`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(strong, soft), `${scheme} accent-strong on accent-soft`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(accent, surface), `${scheme} accent on surface`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(text, soft), `${scheme} text on accent-soft`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('keeps filled actions and the status badge readable in every theme and scheme', () => {
    const themeBlocks = style('tokens.css').split(':root[data-theme="dark"]');
    const controls = [
      { file: 'workbench.css', selectors: ['.run-controls .run-source-action'] },
      { file: 'workbench.css', selectors: ['.command-center'] },
      { file: 'setup.css', selectors: ['.setup-welcome__toolbar .locale-switcher button[aria-pressed="true"]'] },
      { file: 'ide.css', selectors: ['.ide-status'] },
      { file: 'ide.css', selectors: ['.ide-status', '.ide-status__badge'] },
    ];
    for (const [index, theme] of (['light', 'dark'] as const).entries()) {
      for (const scheme of SCHEME_NAMES) {
        const tokens = `${themeBlocks[index]}\n${schemeBlock(scheme, theme)}`;
        for (const { file, selectors } of controls) {
          const [foreground, background] = renderedColors(file, selectors, theme, tokens);
          expect(contrastRatio(foreground, background), `${theme}/${scheme}: ${selectors.at(-1)}`)
            .toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  test('derives selection and focus from the active accent', () => {
    const schemes = style('schemes.css');
    expect(schemes).toMatch(/--selection:\s*color-mix\(in srgb, var\(--accent\)/);
    expect(schemes).toMatch(/--focus-ring:\s*color-mix\(in srgb, var\(--accent\)/);
  });

  test('renders the canvas, chrome, and raised surfaces in pure black or pure white', () => {
    const [lightTokens, darkTokens] = style('tokens.css').split(':root[data-theme="dark"]');
    // The reference asks for a background that is purely black or purely
    // white, so the neutral surfaces carry no tint at all in either theme.
    for (const name of ['--canvas', '--chrome']) {
      expect(token(lightTokens, name), `light ${name}`).toBe('#ffffff');
      expect(token(darkTokens, name), `dark ${name}`).toBe('#000000');
    }
    // Raised and subtle surfaces stay neutral greys so a panel, row, or
    // hover never borrows a hue from the canvas underneath it.
    for (const name of ['--surface', '--surface-subtle', '--surface-raised']) {
      for (const [theme, block] of [['light', lightTokens], ['dark', darkTokens]] as const) {
        const value = token(block, name);
        const channels = hexToRgb(value);
        expect(Math.max(...channels) - Math.min(...channels), `${theme} ${name} is neutral`).toBe(0);
      }
    }
  });

  test('keeps every file-type hue readable on the surfaces it renders on', () => {
    const [lightTokens, darkTokens] = style('tokens.css').split(':root[data-theme="dark"]');
    const lightSurface = token(lightTokens, '--surface');
    const lightSubtle = token(lightTokens, '--surface-subtle');
    const lightChrome = token(lightTokens, '--chrome');
    const darkSurface = token(darkTokens, '--surface');
    const darkSubtle = token(darkTokens, '--surface-subtle');
    const darkChrome = token(darkTokens, '--chrome');
    const tones = ['blue', 'yellow', 'green', 'orange', 'purple', 'red', 'cyan'];

    for (const tone of tones) {
      const light = token(lightTokens, `--file-${tone}`);
      expect(contrastRatio(light, lightSurface), `light ${tone} on surface`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(light, lightSubtle), `light ${tone} on subtle`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(light, lightChrome), `light ${tone} on chrome`).toBeGreaterThanOrEqual(4.5);

      const dark = token(darkTokens, `--file-${tone}`);
      expect(contrastRatio(dark, darkSurface), `dark ${tone} on surface`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(dark, darkSubtle), `dark ${tone} on subtle`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(dark, darkChrome), `dark ${tone} on chrome`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
