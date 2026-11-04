import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { showsShadow } from '../src/editor/scrollShadows';

const styles = readFileSync(resolve(import.meta.dirname, '../src/styles/editor.css'), 'utf8');

describe('scrolled-edge shadows', () => {
  test('shows a band only once its edge has scrolled away', () => {
    // The reference keeps the shadow element at `display: none` and reveals it
    // when the content has moved off that edge, so zero means hidden.
    expect(showsShadow(0)).toBe(false);
    expect(showsShadow(1)).toBe(true);
    expect(showsShadow(0.5)).toBe(true);
    expect(showsShadow(200)).toBe(true);
    // A negative offset is not reachable through scrolling, but it must not
    // reveal a band either.
    expect(showsShadow(-1)).toBe(false);
  });

  test('measures the bands from the reference', () => {
    // `.shadow.top{top:0;left:3px;height:3px;width:100%;box-shadow:
    //  var(--vscode-scrollbar-shadow) 0 6px 6px -6px inset}` and the same
    // rotated for `.left`.
    expect(styles).toMatch(/\.cm-scroll-shadow--top \{[^}]*top: 0;[^}]*left: 3px;[^}]*height: 3px;[^}]*width: 100%;/s);
    expect(styles).toMatch(/\.cm-scroll-shadow--left \{[^}]*top: 3px;[^}]*left: 0;[^}]*height: 100%;[^}]*width: 3px;/s);
    // The observed elements carry inset shadows on their own offsets.
    expect(styles).toMatch(/\.cm-scroll-shadow \{[^}]*box-shadow: var\(--border-strong\) 0 6px 6px -6px inset;/s);
    expect(styles).toMatch(/\.cm-scroll-shadow--left \{[^}]*box-shadow: var\(--border-strong\) 6px 0 6px -6px inset;/s);
    // Hidden until the edge scrolls, exactly as the reference's `display:none`.
    expect(styles).toMatch(/\.cm-scroll-shadow \{[^}]*display: none;/s);
    expect(styles).toMatch(/\.source-editor \.cm-scroll-shadows\.is-scrolled-top \.cm-scroll-shadow--top,\s*\.source-editor \.cm-scroll-shadows\.is-scrolled-left \.cm-scroll-shadow--left \{\s*display: block;\s*\}/s);
    // The overlay must never intercept clicks meant for the text.
    expect(styles).toMatch(/\.cm-scroll-shadows \{[^}]*pointer-events: none;/s);
  });
});
