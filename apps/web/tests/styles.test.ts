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
    // The row action is hidden until it is wanted, so a keyboard user landing on it
    // must be given the same reveal the pointer gets — otherwise `opacity: 0` hides
    // the focus ring too and Tab reaches an invisible destructive control.
    expect(ide).toMatch(/\.ide-tree__row:hover \.ide-tree__remove,\s*\.ide-tree__row--active \.ide-tree__remove,\s*\.ide-tree__remove:focus-visible \{\s*opacity: 1;/s);
    // The status strip keeps its readouts and folds the secondary actions away
    // first when the window is too narrow for the whole row.
    expect(ide).toMatch(/@media \(max-width: 1279px\) \{\s*\.ide-status__item--secondary \{\s*display: none;/);
    // The reference keeps tabular numerals on every status item, and gives an
    // item that carries a background the flush, wider 8 px box.
    expect(ide).toMatch(/\.ide-status__item \{[^}]*font-variant-numeric: tabular-nums;/s);
    expect(ide).toMatch(/\.ide-status__item\[data-state="error"\] \{[^}]*padding: 0 8px;/s);
    expect(ide).toMatch(/\.ide-status__badge \{[^}]*margin: 0;[^}]*padding: 0 5px;/s);
  });

  test('matches the reference status bar and part title geometry', () => {
    const ide = style('ide.css');
    const tokens = style('tokens.css');

    // `.monaco-workbench .part.statusbar{height:22px;font-size:12px}` and
    // `.statusbar-item{line-height:22px}` — the bar is one 22 px line of 12 px
    // type, and an item's line box is the bar's own height.
    expect(tokens).toContain('--vscode-status-height: 22px');
    expect(ide).toMatch(/\.ide-status \{[^}]*min-height: var\(--vscode-status-height\);[^}]*font-size: 12px;/s);
    expect(ide).toMatch(/\.ide-status__item \{[^}]*min-height: var\(--vscode-status-height\);[^}]*line-height: var\(--vscode-status-height\);/s);
    // `.statusbar-item>.statusbar-item-label{margin-right:3px;margin-left:3px;
    // padding:0 5px}` — 5 px inside the hoverable area, 3 px outside it. The item
    // carried a single 6 px padding before, which put 12 px between neighbours
    // where the reference leaves 6 px plus a 6 px inset.
    expect(ide).toMatch(/\.ide-status__item \{[^}]*margin: 0 3px;[^}]*padding: 0 5px;/s);
    // The reference status bar carries no `border-radius` rule at all: a coloured
    // item is a flat full-height block. The badge keeps its filled background
    // because it signals connection state, but must not be a rounded chip.
    expect(ide).toMatch(/\.ide-status__badge \{[^}]*border-radius: 0;[^}]*background: var\(--accent-fill\);/s);
    expect(ide).toMatch(/\.ide-status__badge \{[^}]*min-height: var\(--vscode-status-height\);[^}]*align-self: stretch;/s);

    // `.monaco-workbench .part>.title{height:35px}`, its label fills that height
    // with `line-height:35px`, and the caption is an 11 px regular-weight
    // uppercase label (`… .title-label h2{font-size:11px;font-weight:400}`).
    expect(tokens).toContain('--vscode-title-height: 35px');
    expect(ide).toMatch(/\.ide-sidebar__header \{[^}]*height: var\(--vscode-title-height\);/s);
    expect(ide).toMatch(/\.ide-sidebar__title \{[^}]*font-size: 11px;[^}]*font-weight: 400;[^}]*line-height: var\(--vscode-title-height\);/s);

    // The bar grows to 22 px only through the shared token: a second, private
    // height variable is how the two disagreed before.
    expect(ide).not.toContain('--ide-status-height');
    expect(ide).not.toMatch(/font-size: 11\.5px/);
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
    // The reference marks the pane title's case on a separate rule from the header
    // row: `.pane-header>.title { text-transform: uppercase }`. The 11 px size and
    // the 700 weight already matched; only the case was missing.
    expect(ide).toMatch(/\.ide-pane-header__title \{[^}]*text-transform: uppercase;/s);
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

  test('lights the sidebar search toggles like the find widget options', () => {
    const ide = style('ide.css');
    const editor = style('editor.css');
    // Both search surfaces toggle options the same way: a 22 px icon button in
    // the muted role, lit with the input-option accent while pressed, instead of
    // a native checkbox with a printed label.
    expect(editor).toMatch(/\.find-widget__option\[aria-pressed="true"\] \{[^}]*color: var\(--text\);[^}]*background: var\(--accent-soft\);/s);
    expect(ide).toMatch(/\.ide-search__toggle \{[^}]*min-width: 22px;[^}]*height: 22px;[^}]*border-radius: 5px;[^}]*color: var\(--text-muted\);/s);
    expect(ide).toMatch(/\.ide-search__toggle\[aria-pressed="true"\] \{[^}]*color: var\(--text\);[^}]*background: var\(--accent-soft\);/s);
  });

  test('measures the find widget from the reference', () => {
    const editor = style('editor.css');
    // `.find-widget{height:34px;line-height:19px;padding:0 4px 0 9px;
    //  margin-top:4px;box-shadow:var(--vscode-shadow-lg)}` — the side padding is
    // only 4/9 px because the rows carry their own 17/25 px margins.
    expect(editor).toMatch(/\.find-widget \{[^}]*margin-top: 4px;[^}]*padding: 0 4px 0 9px;[^}]*box-shadow: var\(--shadow-sheet\);/s);
    // Both rows share `.find-part,.replace-part{margin:3px 25px 0 17px;font-size:12px}`.
    expect(editor).toMatch(/\.find-widget__row \{[^}]*height: 34px;[^}]*margin: 3px 25px 0 17px;[^}]*font-size: 12px;/s);
    // `.find-widget .button{width:16px;height:16px;padding:3px;border-radius:5px;margin-left:3px}`
    expect(editor).toMatch(/\.find-widget__button,\s*\.find-widget__option \{[^}]*width: 16px;[^}]*height: 16px;[^}]*padding: 3px;[^}]*border-radius: 5px;/s);
    // `.find-widget>.button.codicon-widget-close{position:absolute;top:5px;right:4px}`
    expect(editor).toMatch(/\.find-widget__button--close \{[^}]*top: 5px;[^}]*right: 4px;/s);
    // `.button.wide{width:auto;padding:1px 6px}` keeps a word label on one line.
    expect(editor).toMatch(/\.find-widget__button--text \{[^}]*width: auto;[^}]*padding: 1px 6px;[^}]*white-space: nowrap;/s);
    // The widget used to inset itself instead of using the reference's row margins.
    expect(editor).not.toMatch(/\.find-widget \{[^}]*padding: 0 26px 0 20px;/s);
  });

  test('dims the minimap canvas like the reference', () => {
    const editor = style('editor.css');
    // `.monaco-editor .minimap canvas{opacity:.9}` is the reference's only opacity
    // rule on the minimap canvas; the strip is never fully opaque. Measured in the
    // built app: the canvas computed to `1` before this rule existed.
    expect(editor).toMatch(/\.source-editor \.cm-minimap-gutter canvas \{\s*opacity: 0\.9;\s*\}/s);
    // The proportional size is `floor(maxColumn × scale / pixelRatio)` with both
    // factors at 1, so the width is a constant 120 px and must not be made
    // content-adaptive: only `fill`/`fit` shrink to the content.
    expect(editor).toMatch(/\.source-editor \.cm-minimap-gutter \{[^}]*height: var\(--editor-visible-height, 100%\) !important;/s);
  });

  test('thickens the panel tab indicator on focus instead of adding a glow', () => {
    // The reference draws the active-item indicator as a 1 px solid top border at
    // `bottom:2px` spanning the item, and doubles it to 2 px in the focus colour
    // while focused: `.action-item:focus .active-item-indicator:before{
    // border-top-color:var(--vscode-focusBorder)!important;border-top-width:2px}`.
    // The tab strip had arrow-key navigation but no focus shape at all.
    const output = style('output.css');
    // The resting indicator keeps the reference geometry.
    expect(output).toMatch(/\.output-tabs \[role="tab"\]\[aria-selected="true"\]::after \{[^}]*bottom: 2px;[^}]*height: 1px;/s);
    // The focused indicator doubles to the reference's 2 px border width.
    expect(output).toMatch(/\.output-tabs \[role="tab"\]:focus-visible::after \{[^}]*content: "";[^}]*bottom: 2px;[^}]*height: 2px;[^}]*\}/s);
    // The global 4 px focus ring is suppressed here, because the reference shapes
    // focus with the indicator rather than a box around a 35 px-tall edge tab.
    expect(output).toMatch(/\.output-tabs \[role="tab"\]:focus-visible \{[^}]*outline: none;[^}]*box-shadow: none;/s);
  });

  test('sets every label on the reference type ladder', () => {
    // The reference's ladder, read from its UI data block as
    // `ld("fontSize.label1", cd(12,"px"), …)`: `label1` 12 px (the control label,
    // 56 uses), `label2` 11 px, `label3` 10 px, `body1` 13 px, `body2` 11 px, and
    // the heading rungs 26/18/13 px — not the 16/18/20/24/32/40/48 this comment
    // claimed before the bundle was read directly. `heading1`'s 26 px is used
    // twice in the whole stylesheet, so no page title should be sized from it.
    // `.dialog-message` is `14px/600`, which is the `text-lg` rung.
    const tokens = style('tokens.css');
    expect(tokens).toMatch(/--font-control: 12px;/);
    expect(tokens).toMatch(/--font-body: 13px;/);
    expect(tokens).toMatch(/--font-dialog-heading: 14px;/);

    // Dialog headings sit on the rung with the reference's weight.
    for (const [file, selector] of [
      ['discardDialog.css', '.discard-dialog h2'],
      ['apiEndpoint.css', '.api-endpoint h2'],
      ['sheets.css', '.edge-sheet__header h2'],
    ] as const) {
      const sheet = style(file);
      expect(sheet, selector).toMatch(new RegExp(`\\${selector} \\{[^}]*font-size: 14px;[^}]*font-weight: 600;`, 's'));
      expect(sheet, selector).not.toMatch(new RegExp(`\\${selector} \\{[^}]*font-size: 15px;`, 's'));
    }

    // No stylesheet may reintroduce a size that falls between the rungs.
    const LADDER = new Set([9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 24, 32, 40, 48]);
    const OFF_LADDER = [12.5, 15, 17];
    for (const file of ['ide.css', 'workbench.css', 'editor.css', 'menu.css', 'settings.css']) {
      const css = style(file);
      for (const size of OFF_LADDER) {
        // 15 px and 17 px remain legitimate for app-owned headings that have no
        // reference counterpart, so only the fractional value is banned outright.
        if (size === 12.5) {
          expect(css, `${file} still uses ${size}px`).not.toMatch(/font-size: 12\.5px/);
        }
      }
      // Everything that is set must land on the ladder.
      for (const match of css.matchAll(/font-size: ([\d.]+)px/g)) {
        expect(LADDER.has(Number(match[1])), `${file} has font-size ${match[1]}px off the ladder`).toBe(true);
      }
    }
  });

  test('lifts every floating surface by the reference elevation step', () => {
    // Measured from the reference's UI data block: `--shadow-sm: 0 1px 2px 0`,
    // `--shadow-md: 0 4px 6px -1px`, `--shadow-lg: 0 10px 15px -3px`, all tinted
    // from one colour source. Our floating surfaces each carried a hand-written
    // shadow whose blur varied from 6 px to 54 px, so popovers lifted unevenly.
    const tokens = style('tokens.css');
    const themeBlocks = tokens.split(':root[data-theme="dark"]');
    for (const [index, theme] of (['light', 'dark'] as const).entries()) {
      // Geometry is copied from the reference; only the tint differs per theme.
      expect(themeBlocks[index], theme).toMatch(/--shadow-float: 0 10px 15px -3px /);
      expect(themeBlocks[index], theme).toMatch(/--shadow-float-sm: 0 4px 6px -1px /);
    }
    // The reference's own tokens, for the record.
    expect(tokens).toMatch(/geometry is copied; the colour stays ours/i);
    // Popovers take the shared step instead of their own numbers.
    for (const [file, selector] of [
      ['menu.css', '.context-menu'],
      ['dropdown.css', '.dropdown__list'],
      ['workbench.css', '.command-palette'],
    ] as const) {
      expect(style(file), selector).toMatch(new RegExp(`\\${selector} \\{[^}]*box-shadow: var\\(--shadow-float\\);`, 's'));
    }
    // Editor tooltips use the smaller step.
    const editor = style('editor.css');
    expect(editor).toMatch(/\.source-editor \.cm-tooltip-autocomplete\.source-completion \{[^}]*box-shadow: var\(--shadow-float-sm\);/s);
    // Sticky scroll is not a floating surface; it keeps the reference's scroll
    // shadow geometry, but the tint comes from a token rather than a literal, so
    // the dark theme can deepen it instead of leaving a black shadow on black.
    expect(editor).toMatch(/\.cm-sticky \{[^}]*box-shadow: var\(--shadow-sticky\);/s);
    expect(editor).not.toMatch(/\.cm-sticky \{[^}]*box-shadow: 0 4px 2px -2px/s);
  });

  test('shapes controls with the reference control radius', () => {
    // The reference's control ladder is `cornerRadius.small: 4px`, used by
    // `.monaco-select-box`, the input wrapper (a literal `4px`), toolbar icon
    // buttons and the breadcrumb picker. Ours used the app-owned 8/10 px, so every
    // control was visibly rounder than the reference.
    const tokens = style('tokens.css');
    expect(tokens).toMatch(/--radius-control: 4px;/);
    expect(tokens).toMatch(/--radius-widget: 8px;/);
    expect(tokens).toMatch(/--radius-dialog: 12px;/);
    // `cornerRadius.medium` is 6 px, read from the bundle's own declaration
    // `ld("cornerRadius.medium", cd(6,"px"), …)`, and drives 79 rules there. The
    // context menu's row highlight uses it directly rather than through a token,
    // because it is a one-off geometry value rather than a shared surface radius.
    expect(style('menu.css')).toMatch(/\.context-menu__item \{[^}]*border-radius: 6px;/s);
    // Global form controls.
    expect(style('base.css')).toMatch(/button,\s*select \{[^}]*border-radius: var\(--radius-control\);/s);
    // Copying surfaces: the search field, the breadcrumb picker and the remote form.
    const ide = style('ide.css');
    for (const selector of ['.ide-search__field', '.ide-breadcrumb-picker']) {
      expect(ide, selector).toMatch(new RegExp(`\\${selector} \\{[^}]*border-radius: var\\(--radius-control\\);`, 's'));
    }
    // The app-owned radii must survive for our own containers, which have no
    // reference counterpart to copy.
    expect(ide).toMatch(/\.ide-main \{[^}]*border-radius: var\(--radius-lg\) var\(--radius-lg\) 0 0;/s);
    // No control may fall back to the app-owned ladder.
    expect(ide).not.toMatch(/\.ide-search__field \{[^}]*border-radius: var\(--radius-sm\);/s);
  });

  test('keeps the breadcrumb steps whole instead of squeezing their labels', () => {
    const ide = style('ide.css');
    // Steps were flex items with min-width:0, so every label overflowed its own
    // box and printed over its neighbour: "directory" wanted 77 px and got 36.
    expect(ide).toMatch(/\.ide-breadcrumbs__step \{[^}]*flex: 0 0 auto;/s);
    expect(ide).toMatch(/\.ide-breadcrumbs \{[^}]*overflow-x: auto;/s);
    // The label itself must not be the thing that shrinks.
    expect(ide).not.toMatch(/\.ide-breadcrumbs__step \{[^}]*min-width: 0;/s);
  });

  test('inherits the reference workbench type size on the tree, tabs, and breadcrumbs', () => {
    const ide = style('ide.css');
    const tokens = style('tokens.css');
    // `.monaco-workbench { font-size: var(--vscode-fontSize-body1) }` is the only
    // type-size rule the reference applies to these three surfaces: no rule sets a
    // size on `.monaco-list-row`, `.monaco-tl-contents`, its `.monaco-icon-label`,
    // `.monaco-breadcrumbs`, or the tab strip. All of them therefore render at
    // `fontSize-body1` = 13 px, not the 11 px on the reference's `body`.
    expect(tokens).toMatch(/--font-body: 13px;/);
    expect(ide).toMatch(/\.ide-tree__row \{[^}]*font-size: var\(--font-body\);/s);
    expect(ide).toMatch(/\.ide-breadcrumbs__step \{[^}]*font-size: var\(--font-body\);/s);
    // The tab's size has to sit on `__select`: it is what paints the name, so a
    // size on `.ide-tab` alone changes nothing the user can see.
    expect(ide).toMatch(/\.ide-tab__select \{[^}]*font-size: var\(--font-body\);/s);
    expect(ide).not.toMatch(/\.ide-tab__select \{[^}]*font-size: 12px;/s);
  });

  test('keeps the tab strip scrollable instead of squeezing tabs to nothing', () => {
    const ide = style('ide.css');
    // A flex tab with min-width:0 collapsed to a bare icon once the strip was
    // full: forty tabs measured 28 px each and every name measured 0 px. The
    // reference's default sizing mode is `fit` — `.tab.sizing-fit { width: 120px;
    // min-width: fit-content; flex-shrink: 0 }` — so the tab keeps a 120 px floor,
    // grows for a longer name, and the strip scrolls rather than shrinking.
    expect(ide).toMatch(/\.ide-tab \{[^}]*width: 120px;/s);
    expect(ide).toMatch(/\.ide-tab \{[^}]*min-width: fit-content;/s);
    expect(ide).toMatch(/\.ide-tab \{[^}]*flex-shrink: 0;/s);
    expect(ide).not.toMatch(/\.ide-tab \{[^}]*flex: 0 0 auto;/s);
    expect(ide).toMatch(/\.ide-tabs \{[^}]*overflow-x: auto;/s);
  });

  test('marks the active tab the way the reference does, without resizing it', () => {
    const ide = style('ide.css');
    // `.tab.active` sets only background, foreground and box-shadow; the reference
    // never sets a weight on a tab. Under `fit` sizing a bold label widened its own
    // tab, so switching tabs shifted every tab in the strip.
    expect(ide).toMatch(/\.ide-tab--active \.ide-tab__select \{[^}]*color: var\(--text\);[^}]*\}/s);
    expect(ide).not.toMatch(/\.ide-tab--active[^{]*\{[^}]*font-weight/s);
  });

  test('keeps the folding chevron hidden until the margin is hovered', () => {
    const css = style('editor.css');
    // `.codicon-folding-expanded/-collapsed { opacity: 0; transition: opacity .5s }`,
    // revealed by `.margin-view-overlays:hover .codicon { opacity: 1 }`.
    expect(css).toMatch(/\.cm-foldMarker \{[^}]*opacity: 0;[^}]*transition: opacity \.5s;/s);
    expect(css).toMatch(/\.cm-foldMarker--closed,[\s\S]{0,120}\.cm-gutters-before:hover \.cm-foldMarker \{\s*opacity: 1;/s);
    // The chevron sits in the margin, so it is a flex-centred 2 px-inset glyph.
    expect(css).toMatch(/\.cm-foldGutter \.cm-gutterElement \{[^}]*display: flex;[^}]*margin-left: 2px;[^}]*cursor: pointer;/s);
    // CodeMirror's sizing spacer must not paint a chevron of its own.
    expect(css).toMatch(/\.cm-foldGutter \.cm-gutterElement:last-child \.cm-foldMarker \{\s*display: none;/s);
    // The folded placeholder is a bare ellipsis, not CodeMirror's bordered box.
    expect(css).toMatch(/\.cm-foldPlaceholder \{[^}]*border: 0;[^}]*background: transparent;[^}]*line-height: 1em;[^}]*cursor: pointer;/s);
    expect(css).not.toMatch(/\.cm-foldPlaceholder \{[^}]*border-radius: \.2em;/s);
  });

  test('relaxes the content width for wrapped lines on the element the class lands on', () => {
    const css = style('editor.css');
    // `contentAttributes` puts `cm-lineWrapping` on `.cm-content` itself, so a
    // descendant selector never matched and word wrap never worked.
    expect(css).toMatch(/\.cm-content\.cm-lineWrapping \{\s*min-width: 0;/s);
    expect(css).not.toMatch(/\.cm-lineWrapping \.cm-content/);
  });

  test('draws whitespace markers as a centred dot and an arrow', () => {
    const css = style('editor.css');
    // A space is a 4 px centred dot; a tab is an arrow, both from the faint text
    // token so they stay legible on both surfaces.
    expect(css).toMatch(/\.cm-renderSpace::before \{[^}]*width: 4px;[^}]*height: 4px;[^}]*border-radius: 50%;[^}]*background: var\(--text-faint\)/s);
    // The CSS escape is written as `'\2192'` (one backslash before the codepoint).
    expect(css).toMatch(/\.cm-renderTab::before \{[^}]*content: '\\2192';[^}]*color: var\(--text-faint\)/s);
  });

  test('colours all six bracket slots in both themes', () => {
    const tokens = style('tokens.css');
    const editorCss = style('editor.css');
    // The reference names its slots foreground1…6, so the app must map all six and
    // define a value for each in both themes — a gap renders as body text.
    for (const slot of [1, 2, 3, 4, 5, 6]) {
      expect(editorCss).toContain(`.cm-rainbowBracket-${slot} { color: var(--syntax-bracket-${slot}); }`);
    }
    const light = tokens.slice(0, tokens.indexOf(':root[data-theme="dark"]'));
    const dark = tokens.slice(tokens.indexOf(':root[data-theme="dark"]'));
    for (const slot of [1, 2, 3, 4, 5, 6]) {
      expect(light).toContain(`--syntax-bracket-${slot}:`);
      expect(dark).toContain(`--syntax-bracket-${slot}:`);
    }
  });

  test('floats the sticky header over the editor without joining the content flow', () => {
    const css = style('editor.css');
    // `.monaco-editor .sticky-widget { position: absolute; z-index: 4;
    //  border-bottom: 1px solid editorStickyScroll-border;
    //  box-shadow: editorStickyScroll-shadow 0 4px 2px -2px }`
    expect(css).toMatch(/\.cm-editor \{\s*position: relative;/s);
    expect(css).toMatch(/\.cm-sticky \{[^}]*position: absolute;[^}]*top: 0;[^}]*z-index: 4;[^}]*border-bottom: 1px solid var\(--border\);[^}]*box-shadow: var\(--shadow-sticky\);/s);
    // The pinned line's number shares the gutter's geometry and figures.
    expect(css).toMatch(/\.cm-stickyLine__number \{[^}]*min-width: calc\(5ch \+ 14px\);[^}]*font-variant-numeric: tabular-nums;/s);
  });

  test('measures the gutter numbers with tabular figures', () => {
    const css = style('editor.css');
    // The reference sets `font-variant-numeric: tabular-nums` on `.line-numbers`;
    // without it the digits are proportional and the column drifts.
    expect(css).toMatch(/\.cm-lineNumbers \.cm-gutterElement \{[^}]*font-variant-numeric: tabular-nums;/s);
  });

  test('keeps the control focus ring off a heading that only takes focus on mount', () => {
    const base = style('base.css');
    // The setup and settings pages move focus to their page heading so assistive
    // technology reads it first. That heading is a reading position, not a
    // control, so the shared rule drops both layers of the control ring instead
    // of every page patching its own heading.
    expect(base).toMatch(/:focus-visible \{\s*outline: 2px solid var\(--accent\);\s*outline-offset: 2px;\s*box-shadow: 0 0 0 4px var\(--focus-ring\);\s*\}/);
    expect(base).toMatch(/h1\[tabindex="-1"\]:focus-visible,\s*h2\[tabindex="-1"\]:focus-visible,\s*h3\[tabindex="-1"\]:focus-visible \{\s*outline: none;\s*box-shadow: none;\s*\}/);
  });

  test('never shrinks a control focus ring below the shared one', () => {
    const dropdown = style('dropdown.css');
    const ide = style('ide.css');
    // The reference has 116 `:focus-visible` rules. Every one either takes the
    // workbench ring or re-states it at `strokeThickness` (1 px) with an offset;
    // none lowers a control's ring below the global one. Two of ours did, by
    // overriding the 2 px + halo ring with a bare 1 px outline, which made a
    // select and the source-control message field half as visible as every other
    // control when reached from the keyboard.
    expect(dropdown).not.toMatch(/\.dropdown__trigger:focus-visible \{[^}]*outline: 1px/s);
    expect(ide).not.toMatch(/\.scm__message:focus-visible \{[^}]*outline: 1px/s);
    // The offset survives: the select's ring sits outside, the field's inside.
    expect(dropdown).toMatch(/\.dropdown__trigger:focus-visible \{[^}]*outline-offset: 2px;[^}]*\}/s);
    expect(ide).toMatch(/\.scm__message:focus-visible \{[^}]*outline-offset: -1px;[^}]*\}/s);
  });

  test('gives a disabled control the reference cursor', () => {
    const base = style('base.css');
    // The reference dims an unavailable control but never changes the pointer to
    // `not-allowed`: the workbench stylesheet uses `cursor: default` 114 times and
    // `not-allowed` zero times, and the packed JavaScript contains neither
    // `not-allowed` nor a `cursor:default` it could have injected. Ours had the
    // warning cursor on the one shared rule, so every disabled button and select
    // disagreed with the reference at once.
    expect(base).toMatch(/button:disabled,\s*select:disabled \{[^}]*cursor: default;/s);
    expect(base).not.toMatch(/cursor: not-allowed/);
  });

  test('draws the overlay slider and the tree roles VS Code uses', () => {
    const base = style('base.css');
    const ide = style('ide.css');
    // VS Code has no scrollbar track, paints a translucent rounded slider that
    // fills the rail, and strengthens it while hovered or dragged. The rail is
    // asymmetric in the reference — `verticalScrollbarSize:14` against
    // `horizontalScrollbarSize:12` — and the slider radius is
    // `cornerRadius.small`, measured at 4px.
    expect(base).toMatch(/::-webkit-scrollbar \{\s*width: 14px;\s*height: 12px;\s*\}/);
    expect(base).toMatch(/::-webkit-scrollbar-track \{\s*background: transparent;\s*\}/);
    expect(base).toMatch(/::-webkit-scrollbar-thumb \{[^}]*border-radius: 4px;[^}]*color-mix\(/s);
    expect(base).toMatch(/::-webkit-scrollbar-thumb:hover \{[^}]*color-mix\(/s);
    expect(base).toContain('::-webkit-scrollbar-thumb:active');
    // The square 10px rail and the 5px slider were the older guesses.
    expect(base).not.toMatch(/::-webkit-scrollbar \{\s*width: 10px;/);
    expect(base).not.toContain('border-radius: 5px;\n  background: color-mix');
    // The selected tree row is a distinct fill with its own foreground, and the
    // indent guides stay hidden until the row is hovered or selected.
    expect(ide).toMatch(/\.ide-tree__row--active \{[^}]*color: var\(--text\);[^}]*background: var\(--accent-soft\);/s);
    expect(ide).toMatch(/\.ide-tree__guides i \{[^}]*background: var\(--border\);[^}]*opacity: 0;/s);
    expect(ide).toMatch(/\.ide-tree__row:hover \.ide-tree__guides i,\s*\.ide-tree__row--active \.ide-tree__guides i \{\s*opacity: 1;/);
    // Every tree label reads at the strong text role: a folder separates itself
    // by its weight, not by a grey the rest of the list does not share.
    expect(ide).toMatch(/\.ide-tree__row--directory \.ide-tree__toggle \{\s*color: var\(--text\);\s*font-weight: 600;\s*\}/);
  });

  test('keeps the VS Code editor typography and gutter roles', () => {
    const editor = style('editor.css');
    // The documented VS Code editor defaults: a 14 px monospace face on a 1.5
    // line box, the gutter painted on the editor surface with five characters
    // reserved for the numbers plus the decoration width, and an active line drawn
    // with hairline rules and **no fill**.
    // The size is a preference now, so the rule reads the custom property.
    expect(editor).toContain('font: var(--editor-font-size, 14px)/1.5 var(--font-mono);');
    expect(editor).toMatch(/\.source-editor \.cm-content \{[^}]*line-height: 1\.5;/s);
    expect(editor).toMatch(/\.source-editor \.cm-gutters \{[^}]*border-right: 0;[^}]*background: var\(--surface\);/s);
    expect(editor).toContain('min-width: calc(5ch + 14px);');
    // `editor.lineHighlightBackground` defaults to null in the reference, so neither
    // the line nor its gutter is filled. The background is set to `transparent`
    // rather than omitted: CodeMirror's base theme otherwise paints the active line
    // pale blue, which shows through on the dark theme.
    expect(editor).toMatch(/\.source-editor \.cm-activeLine,\s*\.source-editor \.cm-activeLineGutter \{\s*background-color: transparent;/);
    // The gutter only changes colour, matching
    // `.line-numbers.active-line-number{color: editorLineNumber-activeForeground}`.
    // It must not carry a *visible* background of its own: the reference keeps the
    // margin flat behind the active row, and a fill there reads as a block of colour.
    // The shared `transparent` rule above is the exception and is what makes the
    // check meaningful — the gutter has to be reset from CodeMirror's pale blue,
    // not merely left alone.
    expect(editor).toMatch(/\.source-editor \.cm-activeLineGutter \{\s*color: var\(--text\);\s*\}/);
    expect(editor).not.toMatch(/\.cm-activeLineGutter \{(?:(?!\})[^}])*background-color: (?!transparent)/);
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

  test('frames the settings screen like the get-started page', () => {
    const settings = style('settings.css');
    // Settings is the welcome page's sibling: the same 13 px/16 px page type, a
    // 1200 px centred frame whose header carries the product mark, a 2.7em page
    // title at weight 400, 1.5em section titles, and one action tile per row
    // (1 px border, 6 px corners, the raised surface). The two roles that stay
    // the settings editor's own are the search field and the two-pixel marker
    // on a setting the user changed.
    expect(settings).toMatch(/\.settings-view \{[^}]*font-size: 13px;[^}]*line-height: 16px;/s);
    expect(settings).toMatch(/\.settings-page \{[^}]*max-width: 1200px;[^}]*grid-template-columns: minmax\(180px, 3fr\) minmax\(0, 8fr\);/s);
    expect(settings).toMatch(/\.settings-page__title \{[^}]*font-size: 2\.7em;[^}]*font-weight: 400;/s);
    expect(settings).toMatch(/\.settings-page__subtitle \{[^}]*font-size: 1\.35em;[^}]*font-weight: 400;/s);
    expect(settings).toMatch(/\.settings-card h2 \{[^}]*font-size: 1\.5em;[^}]*font-weight: 400;/s);
    expect(settings).toMatch(/\.settings-row \{[^}]*padding: 8px 10px;[^}]*border: 1px solid var\(--border\);[^}]*border-radius: 6px;/s);
    expect(settings).toMatch(/\.settings-row--modified::before \{[^}]*left: 0;[^}]*top: 8px;[^}]*bottom: 8px;[^}]*width: 2px;/s);
    // The settings table of contents is a list, not a column of cards. The reference
    // styles `.monaco-list-row` with no border, radius or fill, dims unselected rows to
    // `opacity:.9`, and marks the selected one only by `font-weight:700` — so the
    // assertions here are about the *absence* of the card treatment as much as the
    // presence of the row metrics.
    expect(settings).toMatch(/\.settings-sections \{[^}]*gap: 0;/s);
    expect(settings).toMatch(/\.settings-sections button \{[^}]*height: 22px;[^}]*border: 0;[^}]*background: transparent;[^}]*opacity: 0\.9;/s);
    expect(settings).toMatch(/\.settings-sections button\[aria-current="page"\] \{(?:(?!\})[^}])*font-weight: 700;(?:(?!\})[^}])*opacity: 1;/);
    // No accent tile on the selected row: the reference never fills it.
    expect(settings).not.toMatch(/\.settings-sections button\[aria-current="page"\] \{[^}]*background: var\(--accent-soft\)/);
    // A second `.settings-sections button` rule later in the file silently overrode
    // this block with `min-height:26px`, and because the two live in the same
    // stylesheet the later one wins regardless of how specific the earlier one is.
    // The row rendered 26 px against the reference's 22 px and nothing failed. Only
    // one rule may set the row's box, and it is the first.
    const navBoxRules = [...settings.matchAll(/\.settings-sections button\s*\{([^}]*)\}/g)]
      .map((m) => m[1])
      .filter((body) => /(?:^|;|\s)(?:min-)?height\s*:/.test(body));
    expect(navBoxRules).toHaveLength(1);
    expect(navBoxRules[0]).toContain('height: 22px;');
  });

  test('shapes the context menu like the reference context view', () => {
    const menu = style('menu.css');
    const tokens = style('tokens.css');
    // Measured anchors: the menu is a fixed 13 px context view, and
    // `.monaco-menu .monaco-action-bar.vertical` takes
    // `--vscode-cornerRadius-large`, which the reference defines as 8 px.
    expect(menu).toMatch(/\.context-menu \{[^}]*position: fixed;[^}]*font-size: 13px;/s);
    expect(menu).toMatch(/\.context-menu \{[^}]*border-radius: var\(--radius-widget\);/s);
    expect(tokens).toMatch(/--radius-widget: 8px;/);
    expect(tokens).toMatch(/--radius-dialog: 12px;/);
    expect(menu).toMatch(/\.context-menu__separator \{\s*height: 0;\s*margin: 4px \.8em;\s*padding-top: 1px;\s*border-bottom: 1px solid var\(--border\);/);
    expect(menu).toMatch(/\.context-menu__keybinding \{[^}]*font: 11px var\(--font-ui\);/s);
    expect(menu).toMatch(/\.context-menu__item:disabled \{[^}]*opacity: \.6;/s);
  });

  test('gives context-menu rows the reference menu geometry', () => {
    // These values live in the workbench bundle as a CSS string rather than in
    // its .css file, which is why the row rhythm had been guessed from the list
    // rhythm instead: `.monaco-menu .monaco-action-bar.vertical .action-menu-item
    // { height: 24px; margin: 0 4px; border-radius: cornerRadius-medium }` with
    // `.action-label { padding: 0 1em; font-size: 12px; line-height: 1 }`.
    const menu = style('menu.css');
    expect(menu).toMatch(/\.context-menu__item \{[^}]*min-height: 24px;/s);
    expect(menu).toMatch(/\.context-menu__item \{[^}]*margin: 0 4px;/s);
    expect(menu).toMatch(/\.context-menu__item \{[^}]*padding: 0 1em;/s);
    expect(menu).toMatch(/\.context-menu__item \{[^}]*border-radius: 6px;/s);
    expect(menu).toMatch(/\.context-menu__item \{[^}]*font-size: 12px;/s);
  });

  test('stacks background toasts like the reference notifications', () => {
    const toasts = style('notifications.css');
    // Measured: the stack sits 3 px from the right, just above the 22 px status
    // bar; each entry is 4 px-margined with `--vscode-cornerRadius-large` (8 px),
    // a 10px 5px inset, a 22 px message line, a 12 px source, and a 300 ms
    // slide/fade.
    expect(toasts).toMatch(/\.ide-toasts \{[^}]*right: 3px;[^}]*bottom: calc\(var\(--vscode-status-height\) \+ 3px\);/s);
    expect(toasts).toMatch(/\.ide-toast \{[^}]*margin: 4px;[^}]*padding: 10px 5px;[^}]*border-radius: var\(--radius-widget\);/s);
    expect(toasts).toMatch(/\.ide-toast \{[^}]*animation: ide-toast-in 300ms ease-out both;/s);
    expect(toasts).toMatch(/\.ide-toast__message \{[^}]*line-height: 22px;[^}]*text-overflow: ellipsis;/s);
    expect(toasts).toMatch(/\.ide-toast__source \{[^}]*font-size: 12px;/s);
    expect(toasts).toMatch(/\.ide-toast__close \{[^}]*opacity: 0;/s);
    expect(toasts).toMatch(/\.ide-toast:hover \.ide-toast__close,\s*\.ide-toast:focus-within \.ide-toast__close \{\s*opacity: 1;/);
    // The reference sets no font-size anywhere in its notification rules, so the
    // message inherits `.monaco-workbench { font-size: var(--vscode-fontSize-body1) }`
    // — 13 px, not the 11 px on its `body`. Ours inherited the app's 14 px body
    // size and rendered one pixel large.
    expect(toasts).toMatch(/\.ide-toast \{[^}]*font-size: var\(--font-body\);/s);
    expect(style('tokens.css')).toMatch(/--font-body: 13px;/);
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
    // The reference gives `.quick-input-widget` `cornerRadius-xLarge`, and that
    // token has exactly three consumers in its stylesheet: this widget and the
    // two dialog surfaces. The palette had been on the app-owned 14 px radius,
    // which was two pixels off every other xLarge corner in the app.
    expect(workbench).toMatch(/\.command-palette \{[^}]*border-radius: var\(--radius-dialog\);/s);
    expect(style('tokens.css')).toContain('--radius-dialog: 12px;');
  });

  test('draws the pane splitter with the measured VS Code sash geometry', () => {
    const ide = style('ide.css');
    const tokens = style('tokens.css');
    // Measured from the installed workbench stylesheet: `--vscode-sash-size: 4px`
    // and `--vscode-sash-hover-size: 4px`, `.monaco-sash { position: absolute;
    // z-index: 35; touch-action: none }`, `cursor: ew-resize` / `ns-resize` per
    // orientation, and a `::before` bar that fades in over `.1s ease-out`.
    expect(ide).toMatch(/\.ide-sash \{\s*position: absolute;\s*z-index: 35;\s*touch-action: none;/s);
    expect(ide).toMatch(/\.ide-sash::before \{[^}]*transition: background-color \.1s ease-out;/s);
    // `:root` sets `--vscode-sash-size: 4px` and `--vscode-sash-hover-size: 4px`
    // in the same declaration, so the element box and the painted bar are the same
    // width. An earlier revision of this test asserted an 8 px box, having read the
    // 8 px from `.browser-container>.monaco-sash` — a rule scoped to the splitter
    // inside the browser preview. Widening the box doubled the grab zone and, since
    // the sidebar offset is half the box, pushed the bar off the pane boundary.
    expect(ide).toMatch(/\.ide-sash--vertical \{[^}]*width: 4px;[^}]*height: 100%;[^}]*cursor: ew-resize;/s);
    expect(ide).toMatch(/\.ide-sash--horizontal \{[^}]*width: 100%;[^}]*height: 4px;[^}]*cursor: ns-resize;/s);
    // The visual bar is the pseudo-element, so hovering never widens the hit box.
    expect(ide).toMatch(/\.ide-sash--vertical::before \{[^}]*left: calc\(50% - 2px\);[^}]*width: 4px;[^}]*height: 100%;/s);
    expect(ide).toMatch(/\.ide-sash--horizontal::before \{[^}]*top: calc\(50% - 2px\);[^}]*width: 100%;[^}]*height: 4px;/s);
    // The sidebar sash is offset by half its 4 px box, matching the reference's own
    // `left: calc(50% - (var(--vscode-sash-hover-size) / 2))`.
    expect(ide).toMatch(/\.ide-sash--sidebar \{[^}]*left: calc\(var\(--ide-activity-width\) \+ var\(--ide-sidebar-width\) - 2px\);/s);
    // The reference paints the sash with its hover border, and the app maps that
    // to its own strong border token rather than importing VS Code's colours.
    expect(ide).toMatch(/\.ide-sash:hover::before,\s*\.ide-sash:focus-visible::before,\s*\.ide-sash--active::before \{[^}]*background: var\(--border-strong\);/s);
    // Reduced motion has to reach the new transition as well.
    expect(style('base.css')).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    // The two panes are sized from the reference's defaults and their sashes,
    // not from the app-owned 248 px / 34 % pair the shell shipped with.
    expect(ide).toContain('--ide-sidebar-width: 300px;');
    expect(ide).toMatch(/\.ide-panel-dock \{[^}]*flex: 0 0 var\(--ide-panel-height, 300px\);/s);
    expect(ide).not.toContain('flex: 0 0 34%');
    expect(ide).not.toContain('--ide-sidebar-width: 248px');
    // The splitter colour is a token pair, so both themes stay legible.
    expect(tokens).toMatch(/--border-strong:/);
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

  test('pairs every filled control with a label that stays readable', () => {
    // `schemes.css` declares two label/fill pairs and states that a white label on
    // `--accent-strong` once fell to 2.64:1 on a custom accent. Nothing asserted
    // the pairs themselves, so a scheme could ship an unreadable fill unnoticed.
    const themeBlocks = style('tokens.css').split(':root[data-theme="dark"]');
    const surfaces = [themeBlocks[0], themeBlocks[1]];
    for (const [index, theme] of (['light', 'dark'] as const).entries()) {
      const surface = token(surfaces[index], '--surface');
      for (const scheme of SCHEME_NAMES) {
        const block = theme === 'light' ? lightBlock(scheme) : schemeBlock(scheme, 'dark');
        const fill = token(block, '--accent-fill');
        const onFill = token(block, '--on-accent');
        const strong = token(block, '--accent-strong');
        const onStrong = token(block, '--on-accent-strong');
        expect(contrastRatio(onFill, fill), `${scheme}/${theme} on-accent on accent-fill`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(onStrong, strong), `${scheme}/${theme} on-accent-strong on accent-strong`).toBeGreaterThanOrEqual(4.5);
        // The label must also be distinguishable from the page behind the fill, so a
        // fill that nearly matches the surface cannot hide the control's shape.
        expect(contrastRatio(fill, surface), `${scheme}/${theme} accent-fill on surface`).toBeGreaterThan(1.2);
      }
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

  test('keeps a visible focus ring on the workspace search field', () => {
    // The field hides the global ring so its icon and clear button stay flush.
    // Without a ring on the wrapper a keyboard user had no focus indicator.
    const ide = style('ide.css');
    expect(ide).toMatch(/\.ide-search__field:focus-within \{[^}]*outline: 2px solid var\(--accent\);/s);
    expect(ide).toMatch(/\.ide-search__field:focus-within \{[^}]*border-color: var\(--accent-strong\);/s);
  });

  test('defines the terminal palette in both themes, with the eight slots that differ', () => {
    // The reference keeps a light and a dark value per ANSI slot, and eight of the
    // sixteen genuinely differ. A single shared set would be wrong in one theme.
    const tokens = style('tokens.css');
    const slots = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
      'bright-black', 'bright-red', 'bright-green', 'bright-yellow',
      'bright-blue', 'bright-magenta', 'bright-cyan', 'bright-white'];
    const lightBlock = tokens.slice(tokens.indexOf(':root {'), tokens.indexOf(':root[data-theme="dark"]'));
    const darkBlock = tokens.slice(tokens.indexOf(':root[data-theme="dark"]'));
    for (const slot of slots) {
      expect(lightBlock, `--terminal-ansi-${slot} in the light theme`).toContain(`--terminal-ansi-${slot}:`);
      expect(darkBlock, `--terminal-ansi-${slot} in the dark theme`).toContain(`--terminal-ansi-${slot}:`);
    }
    // Green, yellow, blue, magenta, cyan, white, brightGreen, brightYellow and
    // brightWhite differ between the reference themes; spot-check a few so a
    // future edit cannot collapse the two blocks into one shared palette.
    expect(lightBlock).toContain('--terminal-ansi-green: #107c10');
    expect(darkBlock).toContain('--terminal-ansi-green: #0dbc79');
    expect(lightBlock).toContain('--terminal-ansi-white: #555555');
    expect(darkBlock).toContain('--terminal-ansi-white: #e5e5e5');
  });
});
