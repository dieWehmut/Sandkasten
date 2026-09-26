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
    for (const file of ['tokens.css', 'schemes.css', 'base.css', 'workbench.css', 'editor.css', 'output.css', 'sheets.css', 'ide.css', 'welcome.css', 'settings.css', 'menu.css', 'notifications.css']) {
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
    const tokens = style('tokens.css');
    expect(tokens).toContain('--vscode-status-height: 22px');
    expect(tokens).toContain('--vscode-breadcrumb-height: 22px');
    // The breadcrumb row is the measured 22 px and its steps fill it, so the
    // hover tint covers the row the way the reference's items do.
    expect(ide).toMatch(/\.ide-breadcrumbs \{[^}]*height: var\(--vscode-breadcrumb-height\);[^}]*padding: 0 10px;/s);
    expect(ide).toMatch(/\.ide-breadcrumbs__step \{[^}]*height: 100%;/s);
    // A row action stays inside the 22 px list row instead of stretching it.
    expect(ide).toMatch(/\.ide-tree__remove \{\s*height: 22px;/);
    // The status strip keeps its readouts and folds the secondary actions away
    // first when the window is too narrow for the whole row.
    expect(ide).toMatch(/@media \(max-width: 1279px\) \{\s*\.ide-status__item--secondary \{\s*display: none;/);
    // The reference keeps tabular numerals on every status item, and gives an
    // item that carries a background the flush, wider 8 px box.
    expect(ide).toMatch(/\.ide-status__item \{[^}]*font-variant-numeric: tabular-nums;/s);
    expect(ide).toMatch(/\.ide-status__item\[data-state="error"\] \{[^}]*padding: 0 8px;/s);
    expect(ide).toMatch(/\.ide-status__badge \{[^}]*margin: 0;[^}]*padding: 0 8px;/s);
  });

  test('keeps the measured VS Code chrome geometry', () => {
    const ide = style('ide.css');
    const output = style('output.css');
    const tokens = style('tokens.css');
    // The measured scale lives in tokens.css with the other geometry tokens
    // (read from the installed VS Code workbench stylesheet plus the
    // `workbench.desktop.main.js` constants; see
    // docs/superpowers/specs/2026-09-23-vscode-ui-fidelity-design.md): a 48 px
    // activity lane whose items are 48 px squares marked by a two-pixel border,
    // a 32 px editor tab lane with a one-pixel top accent over the editor
    // surface, 35 px title rows, a 22 px pane header, and a 22 px status strip.
    expect(tokens).toContain('--vscode-activity-item: 48px');
    expect(tokens).toContain('--vscode-activity-marker: 2px');
    expect(tokens).toContain('--vscode-tab-height: 32px');
    expect(tokens).toContain('--vscode-title-height: 35px');
    expect(tokens).toContain('--vscode-pane-header: 22px');
    expect(ide).toContain('height: var(--vscode-tab-height);');
    expect(ide).toContain('min-height: var(--vscode-pane-header);');
    expect(ide).toContain('box-shadow: inset 0 var(--vscode-tab-marker) 0 var(--accent-fill);');
    expect(ide).toMatch(/\.ide-activity__button\[aria-pressed="true"\]::before,\s*\.ide-activity__button:focus-visible::before \{/);
    // The collapsed twisty turns a quarter turn, the way VS Code's twisty does.
    expect(ide).toMatch(/\.ide-pane-header__twisty--collapsed \{\s*transform: rotate\(-90deg\);/);
    // Pane-header actions keep the reference's 16 x 20 action-label box and stay
    // hidden until the row is hovered or holds focus.
    expect(ide).toMatch(/\.ide-pane-header__action \{[^}]*width: 16px;[^}]*height: 20px;[^}]*padding: 2px;/s);
    expect(ide).toMatch(/\.ide-pane-header__actions \{[^}]*opacity: 0;/s);
    expect(ide).toMatch(/\.ide-pane-header:hover \.ide-pane-header__actions,\s*\.ide-pane-header:focus-within \.ide-pane-header__actions \{\s*opacity: 1;/);
    // The breadcrumb picker keeps the measured shape: a 36 px filter row with a
    // 5/9 px inset, 22 px entries, and a border-drawn arrow pointing at the step.
    expect(ide).toMatch(/\.ide-breadcrumb-picker__filter \{[^}]*height: 36px;[^}]*padding: 5px 9px;/s);
    expect(ide).toMatch(/\.ide-breadcrumb-picker__item \{[^}]*line-height: 22px;/s);
    expect(ide).toMatch(/\.ide-breadcrumb-picker__arrow \{[^}]*width: 0;[^}]*border-right: 5px solid transparent;/s);
    expect(ide).toMatch(/\.ide-breadcrumb-picker__name mark \{[^}]*font-weight: 700;/s);
    // The panel title row is sticky inside the panel's scrollport and carries
    // the tabs plus the panel actions; the checked tab is underlined one pixel
    // wide, two pixels above the row's bottom edge.
    expect(output).toMatch(/\.output-tabs__title \{[^}]*position: sticky;[^}]*min-height: var\(--vscode-title-height\);/s);
    expect(output).toMatch(/\.output-tabs \[role="tab"\]\[aria-selected="true"\]::after \{[^}]*bottom: 2px;[^}]*height: 1px;/s);
    expect(output).toContain('text-transform: uppercase;');
  });

  test('draws the overlay slider and the tree roles VS Code uses', () => {
    const base = style('base.css');
    const ide = style('ide.css');
    // VS Code has no scrollbar track, paints a translucent rounded slider that
    // fills the rail, and strengthens it while hovered or dragged.
    expect(base).toMatch(/::-webkit-scrollbar-track \{\s*background: transparent;\s*\}/);
    expect(base).toMatch(/::-webkit-scrollbar-thumb \{[^}]*border-radius: 5px;[^}]*color-mix\(/s);
    expect(base).toMatch(/::-webkit-scrollbar-thumb:hover \{[^}]*color-mix\(/s);
    expect(base).toContain('::-webkit-scrollbar-thumb:active');
    // The selected tree row is a distinct fill with its own foreground, and the
    // indent guides stay hidden until the row is hovered or selected.
    expect(ide).toMatch(/\.ide-tree__row--active \{[^}]*color: var\(--text\);[^}]*background: var\(--accent-soft\);/s);
    expect(ide).toMatch(/\.ide-tree__guides i \{[^}]*background: var\(--border\);[^}]*opacity: 0;/s);
    expect(ide).toMatch(/\.ide-tree__row:hover \.ide-tree__guides i,\s*\.ide-tree__row--active \.ide-tree__guides i \{\s*opacity: 1;/);
  });

  test('keeps the VS Code editor typography and gutter roles', () => {
    const editor = style('editor.css');
    // The documented VS Code editor defaults: a 14 px monospace face on a 1.5
    // line box, the gutter painted on the editor surface with five characters
    // reserved for the numbers plus the decoration width, and a quiet
    // active-line fill with hairline rules instead of an accent wash.
    expect(editor).toContain('font: 14px/1.5 var(--font-mono);');
    expect(editor).toMatch(/\.source-editor \.cm-content \{[^}]*line-height: 1\.5;/s);
    expect(editor).toMatch(/\.source-editor \.cm-gutters \{[^}]*border-right: 0;[^}]*background: var\(--surface\);/s);
    expect(editor).toContain('min-width: calc(5ch + 14px);');
    expect(editor).toMatch(/\.source-editor \.cm-activeLine,\s*\.source-editor \.cm-activeLineGutter \{\s*background-color: var\(--grid-line\);/);
    expect(editor).toContain('box-shadow: inset 0 1px var(--border), inset 0 -1px var(--border);');
    // Bracket matching and occurrence highlighting keep the reference's box and
    // fill roles, drawn inline-safe with inset shadows at a specificity that
    // beats CodeMirror's hard-coded theme colours.
    expect(editor).toMatch(/\.source-editor \.cm-editor\.cm-focused \.cm-matchingBracket \{[^}]*background: var\(--surface-subtle\);[^}]*box-shadow: inset 0 0 0 1px var\(--border-strong\);/s);
    expect(editor).toMatch(/\.source-editor \.cm-editor\.cm-focused \.cm-nonmatchingBracket \{[^}]*background: var\(--danger-soft\);/s);
    expect(editor).toMatch(/\.source-editor \.cm-selectionMatch \{\s*background: var\(--selection\);/);
    expect(editor).toMatch(/\.source-editor \.cm-selectionMatch-main \{\s*background: transparent;/);
    // Indent guides: stripes one `--indent-step` apart, clipped to the line's
    // depth, and the active line must not reset those layers with a background
    // shorthand (the colour is a longhand for exactly that reason).
    expect(editor).toMatch(/\.source-editor \.cm-line\.cm-indent-guides \{[^}]*background-image: repeating-linear-gradient\(to right, var\(--border\) 0 1px, transparent 1px var\(--indent-step, 4ch\)\);/s);
    expect(editor).toMatch(/\.source-editor \.cm-indent-guides-2 \{ background-size: calc\(2 \* var\(--indent-step, 4ch\)\) 100%; \}/);
    expect(editor).toMatch(/\.source-editor \.cm-activeLine,\s*\.source-editor \.cm-activeLineGutter \{\s*background-color: var\(--grid-line\);/s);
    // Text roles that must clear WCAG AA: the gutter's numbers, the menu's
    // accelerator column, and the two empty-state lines all take the muted role
    // because the faint one measured under 4.5:1 on their surfaces.
    expect(editor).toMatch(/\.source-editor \.cm-gutters \{[^}]*color: var\(--text-muted\);/s);
    expect(style('menu.css')).toMatch(/\.context-menu__keybinding \{[^}]*color: var\(--text-muted\);/s);
    expect(style('ide.css')).toMatch(/\.ide-breadcrumb-picker__empty \{[^}]*color: var\(--text-muted\);/s);
    expect(style('welcome.css')).toMatch(/\.editor-welcome__empty \{[^}]*color: var\(--text-muted\);/s);
  });

  test('lays the welcome page out like the Get Started tab', () => {
    const welcome = style('welcome.css');
    // Measured from the reference's `.gettingStartedContainer`: 13 px type on a
    // 16 px line box, a 1200 px two-column grid with a header and a centred
    // footer, a 2.7em product title, 32 px between sections, and 24 px recent
    // rows whose path ellipsises.
    expect(welcome).toMatch(/\.editor-welcome \{[^}]*font-size: 13px;[^}]*line-height: 16px;/s);
    expect(welcome).toMatch(/\.editor-welcome__grid \{[^}]*max-width: 1200px;[^}]*grid-template-rows: 25% minmax\(min-content, auto\) min-content;[^}]*grid-template-columns: 1fr 6fr 1fr 6fr 1fr;/s);
    expect(welcome).toMatch(/grid-template-areas:\s*"\. header header header \."\s*"\. start \. more \."\s*"\. footer footer footer \.";/);
    expect(welcome).toMatch(/\.editor-welcome__title \{[^}]*font-size: 2\.7em;/s);
    expect(welcome).toMatch(/\.editor-welcome__section \{\s*margin-bottom: 32px;/);
    expect(welcome).toMatch(/\.editor-welcome__recent \{[^}]*line-height: 24px;/s);
    expect(welcome).toMatch(/\.editor-welcome__path \{[^}]*text-overflow: ellipsis;/s);
  });

  test('frames the settings screen like the settings editor', () => {
    const settings = style('settings.css');
    // Measured from the settings editor: a 1400 px frame, a header with 24 px
    // insets over a rule, rows with the 12/14/18 padding and a hover highlight,
    // the two-pixel accent bar that marks a changed setting, and 22 px TOC rows.
    expect(settings).toMatch(/\.settings-header \{\s*max-width: 1400px;\s*margin: 0 auto;\s*padding: 12px 24px 0;/);
    expect(settings).toMatch(/\.settings-header__controls \{\s*margin-top: 10px;\s*border-bottom: 1px solid var\(--border\);/);
    expect(settings).toMatch(/\.settings-content__inner \{\s*max-width: 1400px;\s*margin: 0 auto;\s*padding: 6px 24px 48px;/);
    expect(settings).toMatch(/\.settings-row \{[^}]*padding: 12px 14px 18px;/s);
    expect(settings).toMatch(/\.settings-row--modified::before \{[^}]*left: 5px;[^}]*top: 15px;[^}]*bottom: 18px;[^}]*width: 2px;/s);
    expect(settings).toMatch(/\.settings-sections button\[aria-current="page"\] \{\s*color: var\(--text\);\s*font-weight: 700;/);
  });

  test('shapes the context menu like the reference context view', () => {
    const menu = style('menu.css');
    // Measured anchors: the menu is a fixed 13 px context view with the large
    // corner radius, and its separators are a one-pixel rule at `4px .8em`.
    expect(menu).toMatch(/\.context-menu \{[^}]*position: fixed;[^}]*font-size: 13px;/s);
    expect(menu).toMatch(/\.context-menu \{[^}]*border-radius: var\(--radius-lg\);/s);
    expect(menu).toMatch(/\.context-menu__separator \{\s*height: 0;\s*margin: 4px \.8em;\s*padding-top: 1px;\s*border-bottom: 1px solid var\(--border\);/);
    expect(menu).toMatch(/\.context-menu__keybinding \{[^}]*font: 11px var\(--font-ui\);/s);
    expect(menu).toMatch(/\.context-menu__item:disabled \{[^}]*opacity: \.6;/s);
  });

  test('stacks background toasts like the reference notifications', () => {
    const toasts = style('notifications.css');
    // Measured: the stack sits 3 px from the right, just above the 22 px status
    // bar; each entry is 4 px-margined with the large radius, a 10px 5px inset,
    // a 22 px message line, a 12 px source, and a 300 ms slide/fade.
    expect(toasts).toMatch(/\.ide-toasts \{[^}]*right: 3px;[^}]*bottom: calc\(var\(--vscode-status-height\) \+ 3px\);/s);
    expect(toasts).toMatch(/\.ide-toast \{[^}]*margin: 4px;[^}]*padding: 10px 5px;[^}]*border-radius: var\(--radius-lg\);/s);
    expect(toasts).toMatch(/\.ide-toast \{[^}]*animation: ide-toast-in 300ms ease-out both;/s);
    expect(toasts).toMatch(/\.ide-toast__message \{[^}]*line-height: 22px;[^}]*text-overflow: ellipsis;/s);
    expect(toasts).toMatch(/\.ide-toast__source \{[^}]*font-size: 12px;/s);
    expect(toasts).toMatch(/\.ide-toast__close \{[^}]*opacity: 0;/s);
    expect(toasts).toMatch(/\.ide-toast:hover \.ide-toast__close,\s*\.ide-toast:focus-within \.ide-toast__close \{\s*opacity: 1;/);
  });

  test('badges counts the way the reference does', () => {
    const ide = style('ide.css');
    const output = style('output.css');
    // The activity bubble: `top: 24px; right: 8px; font-size: 9px; font-weight: 600;
    // min-width: 8px; height: 16px; line-height: 16px; padding: 0 4px;
    // border-radius: 20px`.
    expect(ide).toMatch(/\.ide-activity__badge \{[^}]*top: 24px;[^}]*right: 8px;[^}]*min-width: 8px;[^}]*height: 16px;[^}]*border-radius: 20px;[^}]*font-size: 9px;[^}]*font-weight: 600;/s);
    expect(ide).toMatch(/\.ide-activity__badge \{[^}]*color: var\(--on-accent\);[^}]*background: var\(--accent-fill\);/s);
    // The count badge: `padding: 3px 5px; border-radius: 11px; font-size: 11px;
    // min-width: 18px; min-height: 18px; line-height: 11px`, tinted by severity.
    expect(output).toMatch(/\.output-tabs__badge \{[^}]*min-width: 18px;[^}]*min-height: 18px;[^}]*padding: 3px 5px;[^}]*border-radius: 11px;[^}]*font-size: 11px;[^}]*line-height: 11px;/s);
    expect(output).toMatch(/\.output-tabs__badge\[data-kind="error"\] \{[^}]*color: var\(--danger\);[^}]*background: var\(--danger-soft\);/s);
    expect(output).toMatch(/\.output-tabs__badge\[data-kind="warning"\] \{[^}]*color: var\(--warning\);[^}]*background: var\(--warning-soft\);/s);
  });

  test('opens the quick input with the measured VS Code geometry', () => {
    const workbench = style('workbench.css');
    // Measured from the installed workbench stylesheet: `.quick-input-widget`
    // is 600 px wide and animates in over 250 ms from its top edge, and
    // `.quick-input-list` rows are 22 px tall with 3 px selection corners.
    expect(workbench).toContain('width: min(600px, calc(100vw - 24px));');
    expect(workbench).toContain('animation: command-palette-open 250ms cubic-bezier(.22, 1, .36, 1) both;');
    expect(workbench).toMatch(/@keyframes command-palette-open \{\s*from \{\s*opacity: 0;\s*transform: translateX\(-50%\) scale\(\.97\);/);
    expect(workbench).toMatch(/\.command-palette__item \{[^}]*min-height: 22px;[^}]*border-radius: 3px;/s);
    expect(workbench).toContain('height: 25px;');
  });

  test('defines stable desktop, tablet, and mobile tracks without gradients', () => {
    const combined = ['base.css', 'workbench.css', 'editor.css', 'output.css', 'sheets.css', 'ide.css', 'welcome.css', 'settings.css', 'menu.css', 'notifications.css']
      .map(style)
      .join('\n');
    const workbench = style('workbench.css');
    expect(workbench).toContain('grid-template-columns: 244px minmax(0, 1fr) 304px');
    expect(workbench).toContain('@media (max-width: 1199px)');
    expect(workbench).toContain('@media (max-width: 767px)');
    // The one gradient in the interface is the editor's guide stripe, which is a
    // functional hairline drawn per indent column in the app's border token
    // rather than decoration: a data-URI image could not carry a token colour.
    const withoutGuides = combined.replace(/\.source-editor \.cm-line\.cm-indent-guides \{[^}]*\}/s, '');
    expect(withoutGuides).not.toMatch(/gradient\(/i);
  });

  test('keeps letter spacing neutral across the operational interface', () => {
    const combined = ['tokens.css', 'schemes.css', 'base.css', 'workbench.css', 'editor.css', 'output.css', 'sheets.css', 'ide.css', 'welcome.css', 'settings.css', 'menu.css', 'notifications.css']
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

  test('keeps every stylesheet balanced and its sections unnested', () => {
    // A merge once landed `ide.css` with three unclosed braces, which nested
    // the source-control and remote rules inside `.ide-remote` and silently
    // removed their styling, so the balance is asserted rather than assumed.
    for (const name of ['base.css', 'ide.css', 'tokens.css', 'workbench.css']) {
      const source = style(name).replace(/\/\*[\s\S]*?\*\//g, '');
      let depth = 0;
      for (const character of source) {
        if (character === '{') depth += 1;
        else if (character === '}') depth -= 1;
        expect(depth, `${name} closes a block it never opened`).toBeGreaterThanOrEqual(0);
      }
      expect(depth, `${name} leaves a block open`).toBe(0);
    }

    // The sections that corruption swallowed must each own their rules, so
    // every known component block has to open at brace depth zero. The merge
    // that broke this file left `.ide-source-control` opening inside
    // `.ide-remote`, which reads as depth one here.
    const ide = style('ide.css').replace(/\/\*[\s\S]*?\*\//g, '');
    let depth = 0;
    const seen = new Set<string>();
    for (const line of ide.split('\n')) {
      const selector = line.trim().replace(/\s*\{$/, '');
      if (line.includes('{') && !line.trimStart().startsWith('}')) {
        if (/^\.ide-[a-z-]+ \{$/.test(line.trim())) {
          expect(depth, `${selector} must open at the top level`).toBe(0);
          seen.add(selector.slice(1));
        }
        depth += 1;
      }
      depth -= (line.match(/\}/g) ?? []).length;
    }
    // The four sidebar views each prove they were reached at the top level.
    for (const name of ['ide-remote', 'ide-source-control']) {
      expect(seen.has(name), `${name} must keep its own top-level block`).toBe(true);
    }
  });
});