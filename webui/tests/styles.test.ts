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

describe('workbench style boundaries', () => {
  test('keeps visual concerns in focused files', () => {
    for (const file of ['tokens.css', 'base.css', 'workbench.css', 'editor.css', 'output.css', 'sheets.css']) {
      expect(style(file).trim().length, file).toBeGreaterThan(0);
    }
  });

  test('declares both token themes and reduced motion', () => {
    const tokens = style('tokens.css');
    const base = style('base.css');
    expect(tokens).toContain('[data-theme="dark"]');
    expect(tokens).toContain('--accent:');
    expect(tokens).toContain('--success:');
    expect(base).toContain('@media (prefers-reduced-motion: reduce)');
    expect(base).toContain('transition: none');
  });

  test('uses the approved accessible green tokens in the light theme', () => {
    const [light] = style('tokens.css').split(':root[data-theme="dark"]');
    expect(light).toContain('color-scheme: light;');
    expect(light).toContain('--canvas: #f3f7f3;');
    expect(light).toContain('--surface: #ffffff;');
    expect(light).toContain('--text: #17231b;');
    expect(light).toContain('--text-muted: #607064;');
    expect(light).toContain('--border: #d5e0d6;');
    expect(light).toContain('--accent: #23834a;');
    expect(light).toContain('--accent-strong: #176235;');
    expect(light).toContain('--focus-ring: #42b96b;');
  });

  test('uses the approved accessible green tokens in the dark theme', () => {
    const dark = style('tokens.css').split(':root[data-theme="dark"]')[1];
    expect(dark).toBeDefined();
    expect(dark).toContain('color-scheme: dark;');
    expect(dark).toContain('--canvas: #101a14;');
    expect(dark).toContain('--surface: #17231b;');
    expect(dark).toContain('--surface-subtle: #203128;');
    expect(dark).toContain('--text: #e8f3ea;');
    expect(dark).toContain('--text-muted: #a9bcae;');
    expect(dark).toContain('--border: #33483a;');
    expect(dark).toContain('--accent: #63d58a;');
    expect(dark).toContain('--accent-strong: #8be8a8;');
    expect(dark).toContain('--focus-ring: #3fbf70;');
  });

  test('keeps semantic states distinct and removes the rose accent palette', () => {
    const tokens = style('tokens.css');
    const [light, dark] = tokens.split(':root[data-theme="dark"]');
    expect(light).toContain('--success: #21865d;');
    expect(light).toContain('--warning: #92550b;');
    expect(light).toContain('--danger: #bd3c48;');
    expect(light).toContain('--info: #3d70a8;');
    expect(dark).toContain('--success: #62c897;');
    expect(dark).toContain('--warning: #e4aa5c;');
    expect(dark).toContain('--danger: #f17b84;');
    expect(dark).toContain('--info: #79a9dd;');
    expect(tokens).not.toMatch(/#(?:d95f8d|ad3767|f9e7ee|f08ab0|ffadca|3a222e)|(?:217 95 141|240 138 176)/i);
  });

  test('keeps light warning text at WCAG AA contrast on its soft background', () => {
    const [light] = style('tokens.css').split(':root[data-theme="dark"]');
    expect(contrastRatio(token(light, '--warning'), token(light, '--warning-soft'))).toBeGreaterThanOrEqual(4.5);
  });

  test('uses a dark foreground for active locale buttons in the dark theme', () => {
    const workbench = style('workbench.css');
    const setup = style('setup.css');
    const tokens = style('tokens.css');
    const dark = tokens.split(':root[data-theme="dark"]')[1];
    const darkSurface = token(dark, '--surface');
    const darkAccent = token(dark, '--accent-strong');

    expect(contrastRatio(darkSurface, darkAccent)).toBeGreaterThanOrEqual(4.5);
    expect(workbench).toMatch(
      /:root\[data-theme="dark"\] \.header-actions \.locale-switcher button\[aria-pressed="true"\] \{\s*color: var\(--surface\);\s*\}/,
    );
    expect(setup).toMatch(
      /:root\[data-theme="dark"\] \.setup-welcome__toolbar \.locale-switcher button\[aria-pressed="true"\] \{\s*color: var\(--surface\);\s*\}/,
    );
  });

  test('uses semantic theme tokens for dark run action text', () => {
    const workbench = style('workbench.css');
    expect(workbench).toMatch(
      /:root\[data-theme="dark"\] \.run-controls \.run-source-action \{\s*color: var\(--surface\);\s*background: var\(--accent\);\s*\}/,
    );
    expect(workbench).not.toContain('color: #21151a;');
  });

  test('defines stable desktop, tablet, and mobile tracks without gradients', () => {
    const combined = ['base.css', 'workbench.css', 'editor.css', 'output.css', 'sheets.css']
      .map(style)
      .join('\n');
    const workbench = style('workbench.css');
    expect(workbench).toContain('grid-template-columns: 244px minmax(0, 1fr) 304px');
    expect(workbench).toContain('@media (max-width: 1199px)');
    expect(workbench).toContain('@media (max-width: 767px)');
    expect(combined).not.toMatch(/gradient\(/i);
  });

  test('keeps letter spacing neutral across the operational interface', () => {
    const combined = ['tokens.css', 'base.css', 'workbench.css', 'editor.css', 'output.css', 'sheets.css']
      .map(style)
      .join('\n');
    const values = Array.from(combined.matchAll(/letter-spacing:\s*([^;]+);/g), (match) => match[1].trim());
    expect(new Set(values)).toEqual(new Set(['0']));
  });
});
