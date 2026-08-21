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
