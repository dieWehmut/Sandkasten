# VS Code UI Fidelity Design

## Context

The WebUI already borrows the VS Code arrangement: activity bar, sidebar,
editor tabs, breadcrumbs, a bottom panel, and a status bar (see
`2026-09-18-desktop-ide-design.md`). The request behind this document is to
imitate the VS Code interface *in detail*, so this design fixes the reference
metrics region by region, records what the workbench does today, and turns the
remaining differences into an ordered, testable plan.

## Status

The plan below ran from the status strip to the editor and back: every region of
the reference screenshot is either implemented with the measured geometry and the
workbench's own colours, or recorded as having no counterpart (with the reason).
The tables name their evidence level, four audits re-checked the result against
the reference and the built distribution (row heights, rendered contrast in all
ten theme × scheme combinations, overlay clamping at three viewports, and entry
point coverage), and the editor now carries the reference's indentation guides as
well.

Two areas stay bounded rather than delivered, both recorded in the candidate list
with the reason: the desktop shell's surfaces (integrated terminal, native menus,
real title bar), which this environment cannot drive, and features that need an
engine Sandkasten does not have (sticky scroll needs a scope tracker, an outline
needs a symbol source, workspace-wide search needs an index).

## Sources of truth

| Source | Use |
| --- | --- |
| `workbench.desktop.main.css` of the installed VS Code build (`resources/app/out/vs/workbench/`, build of 2026-09-15), measured directly | Layout rules: lane widths, strip heights, paddings, radii, animation curves |
| `workbench.desktop.main.js` of the same build | The layout constants the stylesheet reads through CSS variables: `DEFAULT_HEIGHT = 32` / `COMPACT_HEIGHT = 28` for the editor tab lane, `TITLE_HEIGHT = 35` and `HEADER_HEIGHT = 35` for the part title rows, and `window.density.editorTabHeight` as the setting behind them |
| The reference screenshot supplied with the request (VS Code with Git Graph, Live Server, and other extensions) | Which items exist on a real, extension-heavy status bar |
| `apps/web/src/styles/*.css` and `apps/web/src/components/**` | What Sandkasten renders today |

Two rules keep this from becoming a clone:

1. **Geometry is copied, colour is not.** Sandkasten keeps its own tokens
   (`--chrome`, `--surface`, `--text*`, `--accent*`) so all five colour schemes
   and both themes keep working and stay WCAG-AA checked. Roles are matched
   (chrome vs editor surface vs accent), never the hex values of Dark Modern.
2. **The classic workbench is the target.** The installed build also ships the
   "modern UI" floating-card overrides (`--modern-ui-floating-card-*`); the
   reference screenshot shows the classic layout, so that is what these numbers
   describe.

## Measured reference metrics

Values below were extracted from the installed workbench stylesheet; the ones
marked *(theme)* come from the default theme definitions and are treated as
roles rather than copied.

Every claim in this document carries one of five evidence levels, and the table
rows name theirs where it is not obvious:

1. **Measured** — a rule quoted from
   `resources/app/out/vs/workbench/workbench.desktop.main.css` or a constant read
   from the workbench bundle.
2. **Documented default** — an editor default the minified bundle does not expose
   as data (font size 14, `lineNumbersMinChars` 5, `lineDecorationsWidth` 10,
   minimap `size: proportional` / `renderCharacters` / `maxColumn: 120`).
3. **Derived** — geometry the reference computes at runtime rather than in CSS
   (the context menu's row rhythm, whose stylesheet lives in the editor bundle
   this installation does not ship separately; and the radius token *values*,
   which are theme data rather than CSS).
4. **App-owned** — choices with no reference counterpart (all colour values, the
   248 px sidebar, the 34 % panel, the 11.5 px status type and its folding rule).
5. **Not verifiable here** — desktop-shell surfaces (the integrated terminal,
   native menus, the real title bar), which are recorded as boundaries in the
   candidate list rather than claimed as verified.

### Title row

| Property | VS Code |
| --- | --- |
| Row height | 35 px native custom title bar; Sandkasten's integrated row is 40 px to match the Windows overlay |
| Line height | `line-height: 22px` |
| Sections | left / centre (`width: 60%`, `max-width: fit-content`) / right (`width: 20%`), centre always horizontally centred |
| Drag | one absolutely positioned drag region covers the row; every control opts out |

### Activity bar

| Property | VS Code | Sandkasten |
| --- | --- | --- |
| Lane width | `--activity-bar-width: 48px` | 48 px |
| Item box | `--activity-bar-action-height: 48px`, `width: 48px` | 48 × 48 px |
| Icon | `--activity-bar-icon-size: 24px` codicon | 22 px lucide (a 2 px stroke reads heavier than a codicon at the same size) |
| Active item | 2 px `border-left` in `activityBar-activeBorder` across the full item height, plus a rounded `modernActivityBarItem-activeBackground` | rounded `--surface-subtle` selection **and** the 2 px lane marker |
| Hover | foreground steps up to `activityBar-foreground`, rounded hover background | colour step plus `--surface-subtle` |
| Item gap | `--activity-bar-action-gap: 0px` | 0 |
| Keyboard focus | the marker appears on `:focus` | the marker plus a 2 px `:focus-visible` outline |

### Side bar

| Property | VS Code | Sandkasten |
| --- | --- | --- |
| Default width | 300 px (resizable, min 170 px) | 248 px fixed |
| Title row | 35 px (`TITLE_HEIGHT`), `line-height: 35px`, `padding-inline: 8px`, 11 px uppercase label, actions right | 35 px row, 8 px inline inset, 11 px uppercase title, actions + collapse right-aligned |
| Title actions | the explorer's title row offers New File, New Folder, Refresh, and the `workbench.files.action.collapseExplorerFolders` command | New File, Open Folder (desktop), Refresh, and Collapse Folders, which folds every directory in the tree; the explorer's own header in the compact layout carries the same actions |
| Pane/section header | `.monaco-pane-view { --pane-header-size: 22px }`, 11 px bold title, `h3.title` ellipsised with `min-width: 3ch`, a 16 px twisty box holding a 10 px chevron that turns `rotate(-90deg)` when collapsed, `list-hoverBackground` on hover, a 1 px top border on every section but the first | 22 px collapsible "Recent runs" section under the tree, with the same twisty and hover treatment |
| View actions | `.monaco-action-bar .action-label { width: 16px; height: 20px; padding: 2px; margin-right: 2px; display: flex; align-items: center; justify-content: center }`, revealed while the view is hovered or focused | the same 16 × 20 box on the pane header's trailing edge, hidden until the row is hovered or holds focus; the runs section offers "Clear run history" once there is a run |
| Focus after a transient surface | the reference returns focus to where the surface was opened from | the context menu, the breadcrumb picker, and the palette all hand focus back to their opener (the editor, the breadcrumb step, the last control) instead of dropping it on the document |

The title row also carries the sidebar collapse control, a documented
Sandkasten addition.

### Editor group header (tabs) and breadcrumbs

| Property | VS Code | Sandkasten |
| --- | --- | --- |
| Tab lane height | `DEFAULT_HEIGHT = 32` px (28 px in the compact density, `window.density.editorTabHeight`) | 32 px |
| Tab padding | `padding-left: 10px`, label `line-height: <tab height>` | `0 4px 0 10px` |
| Strip background | `editorGroupHeader-tabsBackground` (chrome) | `--chrome` |
| Active tab | `tab-activeBackground` (the editor surface) + `tab-activeForeground` | `--surface` + 1 px top accent |
| Active/selected top border | `tab-border-top-container` 1 px `tab-activeBorderTop`; dirty tabs use a 2 px `tab-dirtyBorderTop` (the opt-in modified-tab highlight) | 1 px top accent |
| Separator | 1 px between tabs, 1 px under the whole strip (`.tabs-border-bottom:after`) | 1 px between tabs and under the strip |
| Close action | 16 px codicon in a 22 px hit area, hidden until hover/active | 22 px target, hidden until hover/active |
| Breadcrumbs | `height: 22px`, items `height: 100%` | a 22 px row (`--vscode-breadcrumb-height`) whose steps fill it, so the hover tint covers the whole row, with chevron separators |
| Breadcrumb picker | `.monaco-breadcrumbs-picker .arrow { position: absolute; width: 0; border-style: solid }`, `.picker-item { line-height: 22px; flex: 1 }`, `.highlighting-tree > .input { padding: 5px 9px; height: 36px }`, `.tree { height: calc(100% - 36px) }`, `.monaco-highlighted-label .highlight { font-weight: 700 }` | a dropdown under the clicked step with a border-drawn arrow, a 36 px filter row, 22 px entries whose matching part is bolded, the entry the trail is on carrying the selection fill, and keyboard/escape/outside-click handling |
| Dirty indicator | the close action renders `codicon-circle-filled` (a ≈ 10 px dot) while the tab is dirty and swaps back to the close glyph on hover | filled dot in the close slot, with the tab naming the unsaved buffer |

### Editor

| Property | VS Code | Sandkasten |
| --- | --- | --- |
| Type | the documented editor defaults: a 14 px monospace face on an automatic line box that Monaco computes at 1.5× the font size (21 px) | 14 px on a 1.5 line box, overriding CodeMirror's 1.4 base |
| Gutter | line numbers in `editorLineNumber-foreground` (`-activeForeground` on the current line) with `font-variant-numeric: tabular-nums`, drawn on the editor background (`editorGutter.background` follows the editor), width from `lineNumbersMinChars` (5) plus `lineDecorationsWidth` (10) | 52 px column on `--surface`, right-aligned numbers in the editor's mono face, no separator line, `--text` for the active line number |
| Active line | `editor-lineHighlightBackground` with a 1 px `editor-lineHighlightBorder` box | `--grid-line` fill with inset hairlines in `--border` |
| Bracket match | `.bracket-match { box-sizing: border-box; background-color: editorBracketMatch-background; border: 1px solid editorBracketMatch-border }` | a `--surface-subtle` fill with a one-pixel inset `--border-strong` box, at a specificity that overrides CodeMirror's hard-coded teal |
| Occurrence highlight | `.focused .selectionHighlight { background-color: editor-selectionHighlightBackground; border: 1px solid editor-selectionHighlightBorder }`, the selected word itself keeping the selection colour | the other occurrences of the selected word get the translucent `--selection` fill through `highlightSelectionMatches()`, while the selected word keeps the selection colour |
| Minimap | `size: proportional`, `renderCharacters: true`, `maxColumn: 120`, `scale: 1` (the first three confirmed in the workbench bundle) | `@replit/codemirror-minimap` with `displayText: 'characters'` and a ≈ 120 px rail (10.6 % of the editor at 1440 px) |

### Welcome page (empty editor)

| Property | VS Code | Sandkasten |
| --- | --- | --- |
| Page | `.gettingStartedContainer { font-size: 13px; line-height: 16px; overflow: hidden; width: 100% }` | the same base type and scrolling behaviour |
| Layout | `.gettingStartedSlideCategories { padding: 12px 24px }` on a `max-width: 1200px` grid, `grid-template-rows: 25% minmax(min-content, auto) min-content`, `grid-template-columns: 1fr 6fr 1fr 6fr 1fr`, areas `". header header header ." ". left-column . right-column ." ". footer footer footer ."` | the same grid with a `start` / `more` column pair and a centred footer |
| Title block | `h1 { font-size: 2.7em; font-weight: 400; padding: 5px 0 0 }`, `.subtitle { font-size: 2em }`, header `align-self: end` so it sits at the foot of the top quarter | 35 px product title at weight 400 with a one-line description under it and the brand mark beside them |
| Section titles | `h2 { font-size: 1.5em; font-weight: 400; margin-bottom: 5px }`, sections 32 px apart | 19.5 px titles, sections 32 px apart |
| Tiles | `.getting-started-category { width: calc(100% - 16px); margin: 8px 8px 8px 0; padding: 4px 6px; border-radius: 6px; line-height: normal }` with a 20 px category icon | the same tile box with the app's surface tokens, an accent icon, and the shortcut pushed to the trailing edge |
| Recent list | `ul { line-height: 24px }`, `li { display: flex; padding-right: 24px }`, `.path { flex: 1; padding-left: 1em; text-overflow: ellipsis }`, a delete affordance revealed on focus | 24 px rows with the file's `vscode-icons` glyph, the ellipsised path, and one row per recently opened file |
| Narrow / short windows | `width-constrained` folds the grid to one column, `height-constrained` hides the header block | one column below 900 px; the title block stays because the brand mark lives in it |

The content is Sandkasten's own — Start (new file, open folder, quick open),
Recent (the editor history), Next steps (setup guide, settings) — and the footer
carries the palette shortcut hint instead of the reference's startup checkbox.

### Settings screen

| Property | VS Code | Sandkasten |
| --- | --- | --- |
| Frame | `.settings-editor { max-width: 1400px; margin: auto; height: 100%; overflow: hidden }`, rows centred in `min(100%, 1400px)` with 24 px insets | a 1400 px centred header and body with the same 24 px insets |
| Header | `.settings-header { margin: 11px auto auto; padding: 3px 24px 0 }`, the search field in the header, `.settings-header-controls { margin-top: 10px; border-bottom: 1px solid }` | the section title and the search field on one row, the rule under them at `margin-top: 10px` |
| Group title | `.settings-group-title-label { font-weight: 600; padding: 10px 10px 10px 15px }`, level 3 at 18 px | 18 px group titles with the same padding |
| Row | `.setting-item-contents { position: relative; padding: 12px 14px 18px }`, `border-radius: cornerRadius-medium`, hover `settings-rowHoverBackground`, focused `settings-focusedRowBackground` | rows with the measured padding and radius, separated by a hover highlight instead of rules |
| Modified marker | `.setting-item-modified-indicator { left: 5px; top: 15px; bottom: 18px; width: 6px; border-left: 2px solid settings-modifiedItemIndicator }` | the same two-pixel bar on a row whose value differs from its default (an overridden color, or a non-default scheme), fed by `useAppearance.customized` |
| Controls | `.setting-item-contents .monaco-select-box { height: 26px; padding: 2px 6px }` | 26 px controls with the same insets |
| Table of contents | a floating TOC dropdown attached to the search field, entries at `line-height: 22px` with the selected entry bold | the app's TOC rail keeps that rail: 22 px entries, bold selection |
| Description | `.setting-item-description { margin-top: -1px; opacity: .9 }` | descriptions at the same weight and opacity under their title |

The theme picker (system / light / dark previews) is app content with no
reference counterpart; it sits above the rows and keeps its own previews.

### Context menu

| Property | VS Code | Sandkasten |
| --- | --- | --- |
| Container (measured) | `.context-view { position: absolute }`, `.context-view.fixed { all: initial; font-size: 13px; position: fixed; font-family: inherit }`, `.monaco-action-bar.vertical { border-radius: cornerRadius-large }` | a fixed 13 px widget with the large radius, a 180 px minimum width, and a 4 px vertical inset |
| Separator (measured) | `.action-item .action-label.separator { display: block; height: 0; border-bottom: 1px solid menu-separatorBackground; padding-top: 1px; margin: 4px .8em; width: 100% }` | the same rule at `margin: 4px .8em`, in `--border` |
| Rows (derived) | the menu body's own stylesheet (`.action-menu-item`, 22 px rows, ~26 px label insets) is shipped inside the editor bundle, which this installation does not expose as CSS | 22 px rows with a 26 px label inset, the accelerator in an 11 px `--text-faint` column, and the pointer/keyboard row highlighted with `--accent-soft` |
| Disabled rows | the reference dims a row that cannot run and skips it while arrowing | `opacity: .6` plus `aria-disabled`, skipped by the arrow keys and unclickable |
| Contents | Cut, Copy, Paste, then the selection, history, and search commands (language-server commands have no counterpart here) | the same order for the seven commands the workbench can perform: Cut, Copy, Paste, Select All, Undo, Redo, Find |
| Right-click | keeps an existing selection when the press lands inside it, otherwise moves the caret to the click | the same; the secondary press is kept away from CodeMirror, which would otherwise reset the selection on any mouse press |
| Keyboard access | the editor menu also opens from the keyboard (`Shift+F10` or the dedicated menu key), anchored at the caret | `Shift-F10` and `ContextMenu` are bound in the editor keymap and open the same menu at the caret, falling back to the editor's own box when the platform cannot report caret coordinates |
| Clipboard limits | the desktop shell owns the clipboard | the web build cannot read the clipboard without permission: Paste is offered only where `navigator.clipboard.readText` exists, a refusal surfaces as an inline `role="alert"` above the editor's bottom edge, and the keyboard shortcuts always work |

### Notifications

| Property | VS Code | Sandkasten |
| --- | --- | --- |
| Stack | `.notifications-toasts { position: absolute; z-index: 2545; right: 3px; bottom: 25px; border-radius: cornerRadius-small }` — the bottom-right corner, just above the 22 px status bar | the same corner at `right: 3px; bottom: calc(var(--vscode-status-height) + 3px)`, 400 px wide |
| Entry | `.notification-toast { margin: 4px }` with `.monaco-list-row { border-radius: cornerRadius-large }` and `opacity: 0; transform: translate3d(0, 100%, 0); transition: transform .3s ease-out, opacity .3s ease-out` (shown with `.notification-fade-in { opacity: 1; transform: none }`) | a 4 px-margined card with the large radius in the app's tokens, fading and sliding in over 300 ms |
| Content | `.notification-list-item { padding: 10px 5px }`, an icon column `flex: 0 0 16px; height: 22px; margin: 0 4px`, `.notification-list-item-message { line-height: 22px; flex: 1; text-overflow: ellipsis }`, `.notification-list-item-source { font-size: 12px }` | the same inset, 16 px icon in a 22 px line, a 22 px ellipsised message and a 12 px source line |
| Actions | `.notification-list-item-toolbar-container { display: none; height: 22px }`, revealed while the entry is hovered or expanded | the close action sits at the card's corner and is revealed on hover or keyboard focus, with the newest message also announced through a visually hidden live region |
| When it appears | any extension or workbench message | the workbench raises one only when work finishes out of sight (a job that settles after the output panel was closed); everything the user is looking at stays inline — the panel, the editor status and the run bar |

### Counts and badges

| Property | VS Code | Sandkasten |
| --- | --- | --- |
| Activity bubble | `.activitybar … .badge .badge-content { position: absolute; top: 24px; right: 8px; font-size: 9px; font-weight: 600; min-width: 8px; height: 16px; line-height: 16px; padding: 0 4px; border-radius: 20px; text-align: center }` in `activityBarBadge` colours | the same offsets and size on the activity bar's icon, in `--accent-fill` / `--on-accent`; the explorer carries the count of buffers with unsaved changes, the role the reference gives its source-control badge, and the count also reaches the item's accessible name |
| Count badge | `.monaco-count-badge { padding: 3px 5px; border-radius: 11px; font-size: 11px; min-width: 18px; min-height: 18px; line-height: 11px; font-weight: 400; text-align: center }`, the pane header's dirty count at `padding: 2px 4px; margin-left: 6px` | the same geometry on the problems tab of the panel (the reference's problems view), tinted by severity — `--danger` on `--danger-soft` when a run failed, `--warning` on `--warning-soft` when it only warned — while a diagnostics channel with content but no counted problem keeps the content dot |
| Where counts come from | the workbench's own registries | the same numbers the status strip reports: unsaved buffers from the workspace, problems from the last run (`runProblemCounts`) |

### Find widget

| Property | VS Code | Sandkasten |
| --- | --- | --- |
| Widget box | `.find-widget { position: absolute; z-index: 35; height: 34px; padding: 0 4px 0 9px; margin-top: 4px; box-shadow: shadow-lg; border-radius: cornerRadius-large }`, floating over the editor's top-right corner and sliding in with a 200 ms `transform` | 400 px widget pinned to the editor's top-right (`top: 6px; right: 6px`) with the app's border, radius and shadow; CodeMirror's own bottom strip is replaced through `search({ createPanel })` |
| Find row | 34 px tall, 13 px input (`.monaco-findInput .input`), `.find-actions { height: 25px }` | 34 px row, 25 px input at 13 px, 3 px gaps |
| Buttons | 16 px codicon in a 22 px hit area (`padding: 3px; border-radius: 5px`), the close action pinned at `top: 5px; right: 4px` | 22 px buttons with inlined 16 px stroked glyphs, 5 px corners, the close button at `top: 6px; right: 4px` |
| Options | `Aa`, `ab`, `.*` toggle buttons that light up with the input-option accent | the same three glyph labels as toggle buttons, `aria-pressed` mirrored from the query and `--accent-soft` when active |
| Match counter | `.matchesCount { margin: 0 0 0 3px; line-height: 23px }`, tabular numerals, `errorForeground` when a query has no result | `current of total` before the navigation buttons in `--text-muted`, `--danger` and a `--empty` modifier when nothing matches |
| Replace row | a second row (`.replace-part`, 25 px inputs) that expands from the widget's leading chevron | the same second row behind the chevron toggle, wired to CodeMirror's `replaceNext` / `replaceAll` |
| Behaviour | Enter / Shift+Enter step through matches, Escape closes, the counter follows the selection | the same, on CodeMirror's `findNext` / `findPrevious` / `selectMatches` / `closeSearchPanel` commands; the counter is computed here because CodeMirror has no match count |

### Panel

| Property | VS Code | Sandkasten |
| --- | --- | --- |
| Title row | `.part>.title` 35 px (`TITLE_HEIGHT`), `padding-inline: 8px`, tabs left and title actions right | 35 px sticky row inside the panel's scrollport, tabs left, maximize/close right |
| Tab label | `.composite-bar-container … .action-item { text-transform: uppercase; padding: 2px 10px; font-size: 11px }`, square, stretched to the row | 11 px uppercase, `2px 10px`, square, stretched |
| Checked tab | `.active-item-indicator:before { bottom: 2px; width: 100%; height: 0; border-top: 1px solid panelTitle-activeBorder }` | 1 px `::after` line, `bottom: 2px`, accent fill |
| Actions | `.title-actions { height: 35px; padding-left: 5px }` on the right of the title row | inline action row with a 5 px left pad |
| Size | resizable, three sizes (default / maximized / restored) | fixed 34 %, maximized state |
| Border | 1 px top `panel-border` on the panel's title | 1 px top `--border` on the panel |
| Body | the panel body scrolls under the fixed title row | the panel scrolls as one region with a sticky title row |

### Status bar

| Property | VS Code | Sandkasten |
| --- | --- | --- |
| Strip | `.part.statusbar { height: 22px; font-size: 12px }`, full width, `overflow: hidden` | 22 px, 11.5 px type (see below) |
| Item | `.statusbar-item { display: inline-block; line-height: 22px; height: 100%; vertical-align: top; max-width: 40vw; font-variant-numeric: tabular-nums }` | full-height items, `tabular-nums` so readouts do not jitter |
| Item label | `.statusbar-item-label { display: flex; height: 100%; margin: 0 3px; padding: 0 5px; white-space: pre; text-overflow: ellipsis }` | `padding: 0 6px` with a 2 px container gap, which lands at the same rhythm |
| Label hover | `.statusbar-item a:hover:not(.disabled) { background-color: statusBarItem-hoverBackground }` — a **square** background, no radius in this build | `color-mix(accent 18%, transparent)`, square |
| Coloured items | `.has-background-color > .statusbar-item-label { margin: 0; padding: 0 8px }`, plus `warning-kind` / `error-kind` / `prominent-kind` modifiers | an item carrying a background (a failed run, the accent badge) uses the measured flush 8 px box; the others keep colour-only modifiers |
| End insets | the first and last visible item take `padding-left/right: 2px` | the strip's own 4 px inset stands in for it |
| Container padding | the spacing scale (`--vscode-spacing-size60`, 6 px) at the ends | 4 px |

The type size is intentionally 11.5 px instead of 12 px: the app's UI font is
Inter, which runs wider than VS Code's system stack, and 11.5 px keeps the
measured row inside a 1280 px window with every readout visible.

### Quick input (command palette)

| Property | VS Code | Sandkasten |
| --- | --- | --- |
| Width | `600px`, horizontally centred below the title row | 600 px, same centring |
| Header / input | `padding: 6px 6px 4px`, `.monaco-inputbox { min-height: 25px; border-radius: 4px }` | same insets, 25 px input |
| Radius / shadow | `cornerRadius-xLarge`, `shadow-xl` | `--radius-lg` (the theme's radius tokens are not measurable from the stylesheet), a 36 px soft shadow |
| Open motion | `.25s cubic-bezier(.22,1,.36,1)` fade + `scale(.97)` from `top center` | same curve and scale; the visible close is instant, so there is no close animation |
| Rows | `line-height: 22px`, `border-radius: 3px`, list `max-height: 440px`, entry `padding: 0 6px`, 16 px icon column | 22 px rows, 3 px corners, 440 px list, 6 px entry padding, 16 px icon column |

### Lists, trees, scrollbars, motion

| Property | VS Code | Sandkasten |
| --- | --- | --- |
| List row | rows are absolutely positioned in a virtualised container, `cursor: pointer`, `padding-left: 2px` | plain 22 px rows with 6 px corners, whose actions stay inside the row height |
| Row hover | `list-hoverBackground` | `--surface-subtle` |
| Row selection | `list-activeSelectionBackground` / `list-inactiveSelectionBackground` with the matching foreground, distinct from hover | `--accent-soft` with `--text`, distinct from the hover tint |
| Tree indent guides | `.monaco-tl-indent>.indent-guide { height: 100%; border-left: 1px solid transparent; opacity: 0 }`, revealed for the active branch with a `.1s linear` opacity transition | one 1 px guide per nesting level, hidden until the row is hovered or selected |
| Scrollbar rail | `.monaco-scrollable-element>.scrollbar { background: scrollbar-background }` (transparent), slider from `scrollbarSlider-background`, `-hoverBackground`, `-activeBackground`, `border-radius: cornerRadius-small` in the modern UI; the rail overlays the content instead of reserving space | `::-webkit-scrollbar` 10 px, transparent track, translucent rounded slider at 40 / 60 / 80 % that strengthens on hover and drag |
| Tab strip rail | `.tabs-container { scrollbar-width: none }` — the editor and panel tab rows scroll without a rail | `scrollbar-width: none` on both tab rows |
| Native scrollbar properties | VS Code draws its own scrollbars in JS, so it never uses `scrollbar-width` for the editor | The standard properties are deliberately not used on scrolling panes: they take precedence in Chromium and would replace the styled geometry |
| Motion | the quick input animates 250 ms open / 150 ms close, indent guides fade in over 100 ms, everything else is near-instant | the same curves where implemented; the global `prefers-reduced-motion` rule disables every animation |

## Plan

| # | Priority | Region | Work | Acceptance |
| --- | --- | --- | --- | --- |
| 0 | done | Status bar | VS Code strip with both groups, accent tint, hover/focus, item actions, 1280 px folding | `tests/statusBar.test.ts`, smoke screenshots |
| 1 | done | Activity bar | 48 px lane items, 22 px icons, 2 px lane marker for the checked item, focus ring, zero gap | `styles.test.ts` geometry assertions, activity-bar screenshots |
| 1 | done | Editor tabs | 10 px left padding, chrome strip, surface-painted active tab with a 1 px top accent, per-tab separators | `styles.test.ts`, tab screenshots, existing tab tests stay green |
| 2 | done | Editor tabs | Dirty dot in the close slot that swaps to the close glyph on hover, with the unsaved state named for assistive technology | `tests/ide.test.ts` dirty-tab coverage, dirty-tab screenshot |
| 2 | done | Quick input | 600 px width, 250 ms open curve, 6 px header inset, 25 px input, 22 px rows with 3 px corners and a 16 px icon column | `tests/styles.test.ts` geometry assertions, palette screenshot |
| 3 | done | Tab lane + title rows | Corrected the editor tab lane to the measured 32 px (`DEFAULT_HEIGHT`), and both the sidebar title row and the panel title row to 35 px (`TITLE_HEIGHT`, `line-height: 35px`, 8 px inline inset) | `styles.test.ts`, chrome screenshots |
| 3 | done | Panel | One 35 px title row holding the tabs and the panel actions, sticky inside the panel's scrollport, tabs at 11 px uppercase with a 1 px underline inset 2 px, panel padding moved to the body | `tests/styles.test.ts`, `outputTabs.test.ts`, panel screenshot |
| 4 | done | Side bar | 22 px collapsible pane header (`--pane-header-size: 22px`) with a 16 px twisty box over the recent runs section, section state owned by `useIdeLayout` | `tests/ide.test.ts` pane-header coverage, sidebar screenshot |
| 4 | done | Tokens | The `--vscode-*` measured scale moved from the shell into `tokens.css` beside the other geometry tokens | `styles.test.ts` reads the scale from `tokens.css` |
| 5 | **this change** | Scrollbars | Overlay-style slider: 10 px rail, transparent track, translucent rounded slider at three strengths, and no rail on the tab rows (`scrollbar-width: none` as VS Code does) | `styles.test.ts` scrollbar assertions, computed-style probe |
| 5 | done | Lists and trees | The selected tree row gets its own fill and foreground instead of reusing the hover tint, and nested rows draw one indent guide per level, revealed on hover or selection | `tests/ide.test.ts` guide coverage, guide fixture screenshot |
| 6 | done | Editor | 14 px on a 21 px line box, the line-number column reserving five editor characters plus the decoration width on the editor surface, the active line as a quiet fill with hairline rules, and the active line number stepping up to the primary foreground | `styles.test.ts` editor assertions, computed-metric probe |
| 7 | done | Find widget | A custom CodeMirror panel that renders VS Code's floating find widget: 34 px find row, 13 px inputs, icon buttons, `Aa`/`ab`/`.*` toggles, a `current of total` counter (CodeMirror has none), an expandable replace row, and the close action in the widget's corner | `tests/findWidget.test.ts`, find-widget screenshots |
| 8 | done | Welcome page | The empty editor rebuilt as the Get Started tab: 13 px base on the measured 1200 px two-column grid with a 25 % title band and a centred footer, a 2.7em product title, 32 px section gaps, tiles with 20 px accent icons, and 24 px recent rows fed by the editor history | `tests/EditorWelcome.test.ts`, `editorWelcomeApp.test.ts`, `welcome.css` geometry assertions, welcome screenshot |
| 9 | done | Settings screen | Framed like the settings editor: a 1400 px frame with 24 px insets, a header carrying the section name and the search field over a rule, 18 px group titles, rows with the measured 12/14/18 padding and hover highlight, 26 px controls, a bold TOC selection, and the two-pixel accent bar on settings the user changed | `tests/SettingsView.test.ts`, `appearance.test.ts`, `settings.css` geometry assertions, settings screenshot |
| 10 | done | Side bar | The view actions VS Code reveals on hover: a 16 × 20 action box on the pane header's trailing edge, hidden until the row is hovered or focused, wired to "Clear run history" whenever the runs section has items | `tests/ide.test.ts` clear-history coverage, `styles.test.ts` action geometry, hover screenshot |
| 11 | done | Editor | A VS Code-style right-click menu in place of the browser's: a fixed 13 px context widget with the measured separator, seven editor commands with their accelerators and availability, arrow-key navigation, viewport clamping, and the reference's "keep the selection you right-clicked inside" rule | `tests/contextMenu.test.ts`, `styles.test.ts` menu geometry, menu screenshots |
| 12 | done | Editor | The reference's matching-bracket box and other-occurrence highlight, drawn with inset shadows because these marks sit inline, plus `highlightSelectionMatches()` so selecting a word lights up its other occurrences | `styles.test.ts` highlight assertions, highlight probe and screenshot |
| 13 | done | Breadcrumbs | Folder and root steps open the reference's picker: a dropdown under the step with a border-drawn arrow, a 36 px filter row, 22 px entries with the matching part bolded and the current entry marked; choosing a folder still reveals it in the explorer, choosing a file opens it | `tests/breadcrumbPicker.test.ts`, `ide.test.ts` trail coverage, picker probe and screenshot |
| 14 | done | Notifications | The reference's bottom-right toast stack (3 px from the right, just above the status bar, 4 px-margined cards, 22 px message, 12 px source, 300 ms slide/fade, hover-revealed close) raised when a run finishes after the output panel was closed | `tests/notifications.test.ts`, `ide.test.ts` toast coverage, `styles.test.ts` toast geometry, toast screenshot |
| 15 | done | Counts and badges | The reference's activity count bubble (24 px down, 8 px in, a 9 px/600 count in a 16 px pill) showing the unsaved buffers, and its count badge (3px 5px, 18 px, radius 11) on the problems tab, tinted by severity | `tests/ide.test.ts` badge coverage, `outputTabs.test.ts` tab badge, `styles.test.ts` badge geometry, badge probes and screenshots |
| 16 | done | Side bar and focus | The explorer's "Collapse Folders" title action (fold every directory, request travelling to the explorer that owns the collapsed state), and focus returning to the opener when the context menu or the breadcrumb picker closes | `tests/ide.test.ts` collapse coverage, `contextMenu.test.ts`/`breadcrumbPicker.test.ts` focus coverage, explorer screenshots and a focus probe |
| 17 | done | Audit | Every measured claim re-checked against the reference and the code: status items gained the measured tabular numerals and background-carrying items the flush 8 px box; the document dropped a hover-radius claim this build does not make, lost its stale "today / target" columns, and records the re-verified list | `styles.test.ts` status assertions, status-strip probe and screenshot, this section's audit notes |
| 18 | done | Audit | A probe measured every documented row height in the built distribution: the explorer row action was stretching tree rows to 26 px, so it now takes the 22 px row height; all ten row metrics match, and the palette's mid-animation numbers were identified as a measurement artefact | `styles.test.ts` row assertions, metric-audit probe |
| 19 | done | Colour and state audit | Every new surface rendered under five schemes × two themes and its rendered contrast computed: four text roles were below WCAG AA on the faint token (menu accelerators, two empty-state lines, editor line numbers) and now use the muted role, so the probe reports 140/140 | `styles.test.ts` text-role assertions, contrast probe, this section's audit notes |
| 20 | done | Overlay and keyboard audit | The overlays measured at three viewports (all inside the viewport and topmost at their centre, with the reference's window-level clamp kept), and the editor menu made reachable without a mouse through `Shift-F10` / the menu key | `overlay-audit-probe` results in the audit section, `tests/contextMenu.test.ts` keyboard coverage |
| 21 | done | Entry points | The palette now covers the title-row and panel actions (refresh, collapse folders, clear history, delete file, maximize panel) and the two accelerators it printed but never bound (`Ctrl+,`, `Ctrl+O`) are wired; the desktop suite unmounts its apps so key handling is not shadowed between cases | `tests/commandCenterApp.test.ts` and `ide.test.ts` entry-point coverage, this section |
| 22 | done | Documentation | The reference status bar walked item by item in both directions (screenshot → workbench, component → document), the five evidence levels stated once, and the stale "next tranche" list replaced with what is genuinely left and what can be measured here | the mapping table and cross-check section above |
| 23–24 | reverted | Editor indent guides | Measured the reference's guide rules and implemented a decoration-based pass; it destabilised CodeMirror's measure/render cycle in Chromium and jsdom across three variants, so the feature was removed again rather than shipped half-working, and the finding is recorded in the candidate list | the "attempted and reverted" note above, and a clean suite (302/302), smoke run and build contract after the revert |
| 25 | reverted | Editor indent guides (second attempt) | Moved the stripe count into the line's class and the character step onto the content element; the editor now settles (so the inline-style churn was the round 23–24 cause), but the decorations still never reached the line elements, and the indent unit has to come from the document rather than CodeMirror's language default | the "second attempt" note above, and the same clean verification after the revert |
| 26 | reverted | Editor indent guides (isolation) | Isolated the two working pieces — a static `EditorView.decorations` renders, and the character step must be published through `contentAttributes` — and narrowed the open question to why a set published through CM's own providers (view plugin or state field) does not render here | the "third attempt and the isolation" note above, and the same clean verification after the revert |
| 27 | parked | Editor indent guides (compartment) | Tried the compartment-held static value as the last mechanism: it does not render either, while the content attribute inside the same compartment does. Four mechanisms over five rounds produced no shippable feature, so the candidate is parked with the full comparison table recorded | the "parked" note above, and a clean verification after the revert (suite aside from one load-related suite timeout that passed in isolation, three browser viewports, build contract) |
| 28 | done | Editor indent guides (shipped) | Read the parked table again and found the real cause: the *builder*, not the publication path — `RangeSetBuilder` sets never render while `Decoration.set` sets do. The guides now ship from a `StateField` with stripes clipped by depth, the step from the document's indentation, and the active-line rule no longer resets them with a background shorthand | `tests/indentGuides.test.ts`, `styles.test.ts` guide assertions, the browser audit (depths, stripe widths, blank-line inheritance, edited line) in both themes, and a clean full verification (306/306, three viewports, build contract) |
| 29 | **this change** | Closure | Re-checked every editor decoration path in one pass (guides, active line, brackets, occurrences) to confirm the round 23–27 lesson is specific to the builder, recorded the status summary at the top of this document, and re-verified the whole stack | the decoration-path table above, and the verification stack: 306/306 tests, three browser viewports, five build-contract checks with a synced distribution |

### The reference status bar, item by item

The screenshot this work started from is a Chinese-locale VS Code status bar. Every
item on it is accounted for below, in the order it appears; the right-hand column
is what the workbench shows instead, or why it has no counterpart.

| Reference item | Sandkasten |
| --- | --- |
| Remote indicator (`><`, the remote name) | the accent badge naming the execution backend (Local / Isolated / API), with the spinner while a run is in flight |
| Branch with a dirty mark (`main*`) | no counterpart — there is no Source Control provider; the *unsaved buffers* the reference reports there live on the explorer's activity bubble and the tab dots |
| Sync counters (`1↓ 0↑`) | no counterpart — no remote to sync with |
| Ports | no counterpart — no forwarded ports |
| Errors (`ⓧ 0`) | the error count from the last run, opening the output panel |
| Warnings (`⚠ 0`) | the warning count from the last run, opening the output panel |
| `Connect` (a live-server-style item) | no counterpart — the app's own connection item names the API origin or the connection state instead |
| `Git Graph` | no counterpart — no git integration |
| `Start Practice` | no counterpart — a marketplace extension |
| `行 281, 列 1` | `行 281, 列 1` — the same two readouts, localized from the editor cursor |
| `空格: 4` | `空格: 4` — the indentation detected from the buffer (tabs or spaces) |
| `UTF-8` | `UTF-8` — the encoding the workbench writes |
| `LF` | `LF` — the line ending detected from the buffer |
| `TOML` (language mode) | the language mode with the file's icon glyph beside it |
| `自动补全 (0)` | no counterpart — no language server or completion provider |
| `Go Live` | no counterpart — a marketplace extension |
| `no schema selected` | no counterpart — no JSON schema registry |
| `Background` | the run readout replaces it: the phase, the duration and the exit code of the last run, which is the only background work this app has |

The workbench's own strip in full, so the table above is the whole story rather
than a sample — leading group: backend badge, connection (API origin or state),
workspace name, active file, unsaved marker, error count, warning count, then the
secondary actions (run history, terminal on the desktop, setup guide, settings);
trailing group: run phase, duration, exit code, cursor position, indentation,
encoding, line ending, language mode. Items fold in that order as the window
narrows below 1280 px, where the secondary actions hide first.

### Next tranche (candidates, with their evidence)

| Region | Candidate | What can be measured first |
| --- | --- | --- |
| Editor sticky scroll | the reference pins the enclosing scope at the top of the editor while scrolling | geometry is measurable (`.monaco-editor .sticky-widget { overflow: hidden; border-bottom: 1px solid editorStickyScroll-border; box-shadow: editorStickyScroll-shadow 0 4px 2px -2px; z-index: 4 }`, `.sticky-line-content { white-space: nowrap }`, the folding chevron's opacity transition), but CodeMirror ships no scope tracker, so the candidate needs its own ancestor walk before a design is worth writing |
| Editor indent guides | the reference draws one guide per indent level; `.monaco-editor .lines-content .core-guide { position: absolute; box-sizing: border-box; height: 100% }` in `editorIndentGuide` colours | a `StateField` publishing one line decoration per nested line, drawn as stripes one indent unit apart and clipped by depth; the step comes from the document's indentation (4ch for a Python file) as a content attribute. Rounds 23–27 failed on the decoration *builder* (`RangeSetBuilder` sets never rendered; `Decoration.set` sets do) — the whole trail is recorded below |
| Integrated terminal styling | the desktop shell's xterm pane | stylable from the stylesheet, but the terminal only exists behind the Electron bridge, which this environment cannot drive, so it can be designed but not verified here |
| Native window chrome | the desktop title bar and native menus | not measurable from the stylesheet and not drivable here; recorded as an evidence boundary rather than a target |
| Outline and timeline views | the reference's symbol views | needs a symbol source; with no language server the only honest candidate is a file-derived outline (headings, top-level definitions), which would be a new heuristic rather than a fidelity change |
| Workspace-wide search and replace | the reference's search view | out of scope: the workspace has no index, and a search view without one would be decoration |

#### Indentation guides: attempted and reverted (rounds 23–24)

The approach was a `ViewPlugin` that decorated each line with a
`Decoration.line` carrying `--indent-step` (one indent unit in `ch`),
`--indent-guides` (how many stripes) and `--indent-active` (how many belong to the
block holding the cursor), with the CSS drawing the stripes as
`repeating-linear-gradient` layers clipped by `background-size`. The computation
was unit-tested and correct, but the editor **never settled** once it was wired
in: `.cm-content` never became stable for the browser probe, and a selection
change hung a jsdom test outright. The decoration pass and the layout it triggers
kept feeding each other.

Three variants were tried before reverting: recomputing only on document and
selection changes; interning the decoration instances at module scope so
`RangeSet.eq` could recognise an unchanged set; and decorating the whole document
instead of the visible ranges. None stabilised the editor, so the feature was
removed rather than shipped half-working — the app is back to the verified state
this document describes.

What a next attempt should avoid: a pass that touches the lines themselves on
every measure. Alternatives worth measuring first are a decoration-free layer
(a guide drawn from the gutter, or a widget that does not participate in line
layout) or CodeMirror's own `EditorView.theme` with a block-level element.

#### Indentation guides: second attempt (round 25)

The second attempt removed the inline styles: the stripe count travels in the
line's **class** (`cm-indent-guides-1 … -12`) and the character step is written
once on the content element, so a decoration never carries a per-line style.

That fixed the instability — the browser probe reached `.cm-content` in seconds
and both themes measured cleanly, so **the inline style churn was indeed the cause
of the round 23–24 loop**. It also surfaced two further facts, both recorded here
because they are what the next attempt needs:

1. **`getIndentUnit` returns 2 for a Python file** in this editor, not the file's
   four spaces, so the stripe step has to come from the document (the same
   `detectIndentation` the status bar already uses) rather than from CodeMirror's
   language default.
2. The decoration pass ran and produced the expected ranges — a trace from the
   built distribution showed `init: 6 ranges` for a seven-line sample and the
   update path firing on edits — but the classes **never reached the line
   elements**: `document.querySelectorAll('.cm-line.cm-indent-guides')` stayed
   empty in both themes, and the custom property written to `.cm-content` was not
   observable either. The publication path, not the computation, is the open
   question.

The attempt was reverted again for the same reason as before — an editor feature
that cannot be shown to work is not shippable — and the app is verified back at
the state this document describes (302/302 unit tests, three browser viewports,
build contract).

#### Indentation guides: third attempt and the isolation (round 26)

This round isolated the problem instead of rebuilding the feature, and two
findings are now firm:

1. **A static decoration renders.** Wiring
   `EditorView.decorations.of(Decoration.set([Decoration.line({ class: '…' }).range(12)]))`
   into the editor and building it put the class on the second line exactly as
   expected (`classes: ["cm-line cm-activeLine", "cm-line scratch-probe", …]`).
   The same experiment with the decoration at an offset *inside* a line rendered
   nothing, which is simply how line decorations work — they must start at a line
   start — and explains the very first scratch attempt's confusing result.
2. **The step has to be a content attribute.** A direct
   `view.contentDOM.style.setProperty('--indent-step', …)` was never observable,
   because CodeMirror owns that element's style attribute. Publishing it through
   `EditorView.contentAttributes.compute(...)` worked on the first try and the
   built distribution reported `--indent-step: 4ch`.

What still did not work: the same decoration set published from a `ViewPlugin`
(round 25) or from a `StateField` with
`provide: (field) => EditorView.decorations.from(field)` (this round) never
reached the line elements, even though the field's sibling extension in the same
array provably applied its content attribute. So the open question is narrow and
concrete: **why does a set published through CM's own decoration providers not
render here, while a static `EditorView.decorations` set does?** The next attempt
should start from that difference — most likely by shipping the guides as a
recomputed static extension (a `Compartment` reconfigured on document changes) or
by checking CM's provider combination against the extension array we build.

The feature was reverted a third time, and the app is again verified at the state
this document describes.

#### Indentation guides: root cause found, and shipped (round 28)

The table above was read one more time and turned out to be misleading: the
decorations never rendered because of the **builder**, not the publication path.
Two static decorations were placed side by side in the editor's extension list,
identical except for how the set was built:

| Form | Renders? |
| --- | --- |
| `EditorView.decorations.of(set)` where the set came from `RangeSetBuilder` | **no** |
| the same value where the set came from `Decoration.set(ranges, true)` | **yes** |

Every earlier attempt (view plugin, state field, compartment) had built its set
with `RangeSetBuilder`, which is why all of them looked like publishing failures.
With `Decoration.set` the guides render from a `StateField` provider on the first
try, so the shipped implementation is:

- `src/editor/indentGuides.ts` builds one line decoration per nested line from a
  sorted array (`Decoration.set(ranges, true)`), interns the per-depth decoration
  so an unchanged pass is not a change, and publishes it through a `StateField`;
- the character step travels as a content attribute
  (`EditorView.contentAttributes.compute([], …)` → `--indent-step: Nch`), taken
  from the document's own indentation rather than CodeMirror's language default;
- the stripes are CSS layers clipped to the line's depth
  (`.cm-indent-guides-N { background-size: calc(N * var(--indent-step)) }`), so a
  blank line inherits the block around it and the guides run through it.

The audit that landed it measured, in both themes: `--indent-step: 4ch` for a
Python file, six decorated lines, depth 1 and 2 stripes **30.79 px** and
**61.58 px** wide (exactly one and two indent units), the blank lines carrying the
inner block's guides, and an edited line keeping its stripes. That last check
found a real bug: the active-line rule used the `background` *shorthand*, which
reset the guide layers on the very line the cursor was on — it sets
`background-color` now.

The reference rules are unchanged from the attempt note: the guides are stripes
one indent unit apart, in the ordinary and (for the cursor's block) stronger
share of the editor's guide colours.

Two environment notes from this round, for whoever repeats it: the editor and its
probes are sensitive to machine load (a second project's Vite dev server spinning
in the background timed out one probe and one full-suite case, both of which
passed in isolation afterwards), and the suite must be run from `apps/web` —
running `npx vitest` from the repository root picks up unrelated test files from
other directories.

## Non-goals

- No language server, debugger, multi-root workspaces, or extension host — the
  status strip reports run facts, not diagnostics from a language server.
- No cloning of VS Code's colour values, codicon set, or marketplace items: the
  reference screenshot's extension items (Git Graph, Start Practice, Live
  Server, autocomplete, schema, Background) have no counterpart in Sandkasten
  and stay mapped onto the workbench's real actions.
- No new dependency: icons stay lucide, the editor stays CodeMirror.
- Notifications exist only for work that finishes out of sight; the workbench
  does not toast what the user is already looking at, and it has no notification
  centre (the stack dismisses itself after a few seconds).

## Entry points

The reference's rule is that every action a visible control offers is also a
command, and that an accelerator shown in the palette is really bound. Auditing
the three entry points (keyboard, palette, visible control) against each other
found both kinds of gap:

- **Advertised but unbound**: the palette printed `Ctrl+,` (open settings) and
  `Ctrl+O` (open folder) with no handler behind them. Both are now bound in the
  global key handler, so the palette only ever prints live accelerators.
- **Only reachable from a control**: the title rows' and panel's actions — refresh
  files, collapse folders, clear the run history, delete the active file, and
  maximize/restore the panel — had no palette entry. All five are commands now
  (the collapse request travels from the palette through the same token the title
  action uses), with the panel command relabelled through the localized
  `ide.panel.maximize` / `ide.panel.restore` pair as its state changes.
- **Deliberately out of the palette**: editor-scoped commands (find, the context
  menu's clipboard actions) stay on their own surfaces, because this palette is
  not focus-context-aware while the reference only lists editor commands while
  the editor has focus.
- **Test hygiene**: the desktop suite mounted the whole app without unmounting it,
  so a later case saw keys consumed by an earlier shell's global listener
  (`Ctrl+O` looked broken when it was not). The suite now unmounts automatically,
  and the shortcut is asserted through the bridge it calls.

## Verification

- `apps/web/tests/styles.test.ts` pins the measured geometry (`48 px` activity
  item, `2 px` marker, `32 px` tab lane, `35 px` title rows, `22 px` pane header
  and status strip) the same way it already pins the status-strip conventions.
- `apps/web/tests/ide.test.ts` and `statusBar.test.ts` cover the behaviour those
  styles describe, `findWidget.test.ts` covers the find widget's counting and
  controls, and `tests/setup.ts` carries the two jsdom gaps the editor hits
  (canvas, and `Range` measurement when CodeMirror scrolls to a match).
- `npm run test:browser` drives installed Chrome over the built distribution at
  1440×900, 1024×768, and 390×844 and fails on horizontal overflow or
  overlapping controls, so a geometry change cannot silently break a region.
- Zoomed screenshots of the activity bar, tab strip, and status strip are
  captured from the built distribution for the light and dark themes.
- The suite stands at **306 passing tests in 46 files**, the browser smoke run at
  three viewports, and `tests/build-contract.test.mjs` at five checks over the
  four-file distribution.

### Decoration paths re-checked (round 29)

With the indentation guides shipped, every decoration path the editor relies on
was measured once more in the built distribution, in one pass:

| Path | Evidence |
| --- | --- |
| Indent guides (state field provider) | 3 decorated lines on a three-line nested sample |
| Active line (`highlightActiveLine`) | 1 `.cm-activeLine` |
| Bracket matching (`bracketMatching`, CodeMirror's own value) | the pair `(` `)` marked, with the boxed `1px inset` shadow the design prescribes |
| Occurrence highlighting (`highlightSelectionMatches`, a view plugin provider) | selecting `value` highlighted its 2 other occurrences with the translucent accent fill |

So the round 23–27 failure was specific to how those sets were *built*
(`RangeSetBuilder` versus `Decoration.set`), not to CodeMirror's provider
mechanism: a view plugin's decorations render in this editor, exactly as the
occurrence highlight shows.

### Documentation cross-check (round 22)

Both directions were walked once more, starting from the reference screenshot
rather than from the code:

- **Reference → document**: every item on the screenshot now has a row in the
  status bar mapping table above, either as the counterpart the workbench shows or
  as an explicit "no counterpart" with the reason.
- **Code → document**: the strip's own item list was read out of
  `IdeStatusBar.vue` (backend → connection → workspace → file → unsaved → errors →
  warnings → runs → terminal → setup → settings, then phase → duration → exit code
  → cursor → indentation → encoding → line ending → language) and matches the
  table, including the language item's file glyph and the 1279 px fold rule.
- **Stale content removed**: the "Next tranche" table still listed the pane-header
  actions, the context menu and notifications as missing after all three had
  shipped; it now lists what is genuinely left, each with the evidence that can
  actually be gathered here.
- **Evidence levels made explicit**: the five levels above are now stated once, so
  no row silently mixes a measured rule with a derived value or an app choice.

### Audit (round 17)

Every claim in the tables above was re-checked against the installed stylesheet
and the implementation, which turned up two real gaps and three stale
descriptions:

- **Fixed in code**: status items now carry the measured
  `font-variant-numeric: tabular-nums`, and items that carry a background (a
  failed run, the accent badge) take the measured flush `margin: 0; padding: 0
  8px` box instead of a rounded 6/7 px one.
- **Fixed after measuring the running build**: the breadcrumb row was 29 px tall
  (2 px step padding inside a 3 px-inset strip) while the reference documents
  22 px, so the strip now takes `--vscode-breadcrumb-height` with its steps at
  `height: 100%` and no vertical padding; the probe reports 22 px at both 1440 px
  and 1280 px. The explorer's row action was 26 px tall and stretched every tree
  row with it, so it now takes the row's own 22 px.
- **Measured row by row in the built distribution** (a probe that reads
  `getBoundingClientRect` for each row the tables above claim a height for):
  activity item 48, tab lane 32, sidebar title row 35, panel title row 35, panel
  tab 35, pane header 22, breadcrumb 22, status strip 22, tree row 22, quick-input
  row 22 and input 25 (measured after the 250 ms open motion settles — mid-flight
  the widget is still scaled, which is itself the documented `scale(.97)`
  entrance), find-widget row 34 with a 25 px input and 22 px buttons. The first
  pass of that probe is what exposed the tree row above; the same pass showed the
  palette numbers as an artefact of measuring during its animation rather than a
  drift.

### Colour and state audit (round 19)

A second probe renders every new surface in the built distribution under **all ten
combinations** — five colour schemes (`green`, `purple`, `pink`, `white`, `black`)
× two themes — and computes the WCAG ratio of the text it shows against the
background it actually sits on (compositing translucent layers up the ancestor
chain). Text needs 4.5:1, pictorial marks 3:1.

Four text roles failed and were moved from the faint to the muted role; the probe
now reports **140/140 checks** passing:

| Surface | Was | Now | Measured |
| --- | --- | --- | --- |
| Context menu accelerator | `--text-faint` | `--text-muted` | 4.05 (light) / 4.30 (dark) → passes in all ten |
| Breadcrumb picker empty state | `--text-faint` | `--text-muted` | 5.73 (light) / 6.74 (dark) |
| Welcome page empty state | `--text-faint` | `--text-muted` | same muted-on-editor-surface pair as the breadcrumb step (7.73) |
| Editor line numbers | `--text-faint` | `--text-muted` | 4.21 (light, under AA) / 4.94 (dark) → 5.73 (light) |

Surfaces that passed unchanged: menu labels, picker entries and its filter field,
toast message (13.79), toast source (6.74), toast icon (5.83 against a 3:1
requirement), the panel's count badge (5.43), the activity bubble (6.31–17.76
across schemes), breadcrumb steps (7.73) and status items (12.79–13.48).

Two measurement traps were recorded while building this probe, because both first
looked like product defects: a `:disabled` menu row measures 4.3–4.5:1 (the
reference dims unavailable commands too, and WCAG exempts them), and anything
inside the palette is scaled while its 250 ms entrance runs, so it must be
measured once the motion settles.

### Overlay and keyboard audit (round 20)

A third probe drives the built distribution at the three supported viewports
(1440×900, 1024×768, 390×844) and asserts, for every surface opened over the
content, that it lands **fully inside the viewport** and is the **topmost element
at its own centre**:

| Viewport | Context menu | Breadcrumb picker | Toast |
| --- | --- | --- | --- |
| desktop 1440×900 | opens by mouse and by keyboard, clamped with 4 px margins on both axes | inside, topmost | card and stack inside, bottom clears the 22 px status strip by 7 px |
| tablet 1024×768 | same, 4 px margins | not in this layout (the IDE chrome is desktop-only) | inside, clears the footer by 29 px |
| mobile 390×844 | same, 4 px margins | not in this layout | inside; the 400 px card clamps to the viewport (370 px wide at 390 px) |

Two honest readings from that pass:

- The context menu clamps to the **window**, so near the bottom edge it can overlap
  the status strip (the probe reports the overlap as −18 px on desktop). That
  matches the reference, whose context view is clamped to the workbench container
  rather than to the editor area, so it is kept.
- The menu is reachable **without a mouse**: `Shift-F10` and the dedicated menu key
  are bound in the editor keymap and open the same menu at the caret. Verified in
  all three viewports, in addition to the unit test that drives the key events.
- **Corrected in this document**: the status bar's hover background was described
  as rounded, but this build's rule
  (`.statusbar-item a:hover:not(.disabled) { background-color: … }`) has no
  radius, so the square hover is the faithful one; the activity bar table still
  carried its early "today / target" columns after the work landed; and the
  status bar's coloured-item and end-inset rows now quote the rules verbatim.
- **Re-verified as matching**: the measured geometry tokens (48 px activity item
  with a 2 px marker, 32 px tab lane, 35 px title rows, 22 px pane header and
  status strip), the tab padding and separator, the 22 px breadcrumb row (reached
  through `padding: 3px 10px` rather than a fixed height), the sticky 35 px panel
  title row, the 600 px quick input, the 400 px find widget at `top: 6px;
  right: 6px`, and the 10 px scrollbar rail.