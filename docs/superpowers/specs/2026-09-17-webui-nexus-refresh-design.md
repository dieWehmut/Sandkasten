# WebUI Nexus Refresh Design: Accent Schemes and Surface Polish

## Context

`apps/web` is the Vue 3 workbench shared by GitHub Pages, the installer-managed
site, and the Electron desktop shell. It currently ships a single green accent
with a light and a dark surface theme. `D:\project\Nexus\src` was supplied as
the design reference: it demonstrates a five-scheme accent system with a random
chromatic choice on a first visit, a persisted explicit preference, and
accent-driven chrome (selection, focus, scrollbars). It also prefers a CJK font
ahead of the generic sans-serif fallback.

This design adopts those techniques where they fit an operational workbench and
rejects the parts that do not: no particle or sakura canvases, no custom
cursors, no background audio, and no bundled webfont. The four-file
distribution contract (`index.html`, `app.js`, `styles.css`, `config.js`) means
a multi-megabyte CJK face cannot ship, so only the font stack changes.

## Goal

Let a user pick one of five accent schemes, remember the choice, and still meet
the accessibility and layout contracts the workbench already enforces.

## Requirements

1. Five schemes: `green`, `purple`, `pink`, `white`, `black`. `green` keeps the
   exact token values the workbench shipped with, so an untouched install
   renders identically.
2. Every scheme must meet WCAG AA (>= 4.5:1) on the pairs the interface
   actually renders, in both themes.
3. A first visit without a stored preference picks a random *chromatic* scheme
   and does not persist it, so a reload can land on a different accent. The
   monochrome schemes stay opt-in.
4. An explicit choice persists in `localStorage` as `sandkasten-color-scheme`.
5. The scheme reaches the document as `data-color-scheme` on `<html>` before
   the workbench renders, so the first paint already uses the right accent.
6. The header exposes a picker with stable `data-action` hooks, localized
   labels, `aria-expanded` state, and a swatch per scheme.
7. Selection and focus-ring tokens follow the active accent.
8. All existing contracts hold: exactly four distribution files, `config.js`
   loaded before `app.js`, `letter-spacing: 0`, no gradients, reduced-motion
   support, and no horizontal overflow or overlapping controls at the desktop
   (1440x900), tablet (1024x768), and mobile (390x844) smoke viewports.

## Architecture

### Token split

`tokens.css` keeps the neutral surfaces (canvas, text, borders, semantic
states) and the non-color tokens. Accent tokens move to a new `schemes.css`
that is imported directly after `tokens.css` in `main.ts`:

- `:root, :root[data-color-scheme="green"]` carries the historical green
  values, so the default selector still resolves without JavaScript.
- `:root[data-theme="dark"], :root[data-theme="dark"][data-color-scheme="green"]`
  carries the dark green values.
- Each other scheme contributes two blocks, one per theme.
- A final `:root[data-color-scheme]` block derives `--selection` and
  `--focus-ring` from `--accent` with `color-mix()`. The static fallbacks stay
  in `tokens.css` for engines without `color-mix()`.

Every scheme therefore overrides exactly three tokens per theme
(`--accent`, `--accent-strong`, `--accent-soft`), and components never learn
which scheme is active.

### Palette

Contrast was verified numerically before adoption; the palette test in
`apps/web/tests/styles.test.ts` recomputes every pair on each run.

| Scheme | Light accent / strong / soft | Dark accent / strong / soft |
| --- | --- | --- |
| green | `#23834a` / `#176235` / `#e1f2e6` | `#63d58a` / `#8be8a8` / `#1f422d` |
| purple | `#7c3aed` / `#5b21b6` / `#ede9fe` | `#b79bfd` / `#cdb6ff` / `#2c2145` |
| pink | `#db2777` / `#9d174d` / `#fce7f3` | `#f591bd` / `#ffb3d4` / `#40202f` |
| white | `#767676` / `#4f4f4f` / `#ececec` | `#ffffff` / `#d4d4d4` / `#2a2a2a` |
| black | `#1a1a1a` / `#000000` / `#e6e6e6` | `#9a9a9a` / `#cfcfcf` / `#262626` |

The monochrome schemes deliberately swap polarity between themes: `white` is a
deep gray in the light theme and pure white in the dark theme, so "white" reads
as the strongest available contrast in either theme rather than as a literal
color.

### State

`src/theme/colorScheme.ts` owns the catalog: ids, preview swatches, tone, a
`resolveColorScheme` guard, and `pickRandomColorScheme` over the chromatic
subset only. It stays free of Vue and DOM access.

`src/composables/useColorScheme.ts` mirrors `useTheme`: it reads storage,
resolves the initial scheme (stored, else random), writes `data-color-scheme`,
and persists only explicit choices. Storage access is wrapped in `try/catch` so
a blocked backend cannot prevent the visible change.

### Picker

`ColorSchemeSwitcher.vue` renders a toggle button plus a menu that is mounted
only while open. The menu closes on selection, on Escape, and on an outside
pointer press, and ignores presses inside itself. Using an explicitly
controlled menu instead of `<details>` keeps the behavior identical in jsdom
tests and in browsers, and avoids author `display` rules overriding the
user-agent hiding of closed `<details>` content.

## Verification

- `apps/web/tests/styles.test.ts`: per-scheme, per-theme contrast pairs plus the
  `color-mix()` derivation.
- `apps/web/tests/colorScheme.test.ts`: catalog, random-pick, storage, and
  failure-path behavior.
- `apps/web/tests/HeaderLocale.test.ts`: picker markup, localization, menu-open
  state transitions, and App-level persistence.
- `scripts/webui-browser-smoke.mjs`: real-browser scheme switch, persistence
  check, and accent-token assertion at all three viewports.
- Existing gates: `npm test`, `scripts/webui-build-test.sh`, and
  `scripts/apps-layout-test.sh`.

## Non-goals

- Bundling a CJK webfont (incompatible with the four-file payload).
- Nexus decoration that does not serve a workbench: particle backgrounds,
  custom cursors, scroll progress, and console animations.
- Changing the API, the CLI, or the desktop shell.