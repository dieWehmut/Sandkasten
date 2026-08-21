import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const stylesRoot = resolve(import.meta.dirname, '../src/styles');

function style(name: string): string {
  return readFileSync(resolve(stylesRoot, name), 'utf8');
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
    expect(light).toContain('--warning: #a86312;');
    expect(light).toContain('--danger: #bd3c48;');
    expect(light).toContain('--info: #3d70a8;');
    expect(dark).toContain('--success: #62c897;');
    expect(dark).toContain('--warning: #e4aa5c;');
    expect(dark).toContain('--danger: #f17b84;');
    expect(dark).toContain('--info: #79a9dd;');
    expect(tokens).not.toMatch(/#(?:d95f8d|ad3767|f9e7ee|f08ab0|ffadca|3a222e)|(?:217 95 141|240 138 176)/i);
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
