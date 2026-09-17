# WebUI Nexus Refresh Plan

Design: `docs/superpowers/specs/2026-09-17-webui-nexus-refresh-design.md`

Each task lands as its own commit so a reviewer can accept or drop one slice
without touching the others. Tasks 1 and 2 are ordered because the picker
depends on the scheme layer.

## Task 1: Accent scheme token layer

- Add `src/theme/colorScheme.ts` with the five-scheme catalog, tone metadata,
  `resolveColorScheme`, and `pickRandomColorScheme` over the chromatic subset.
- Add `src/composables/useColorScheme.ts` with storage restore, randomized
  first visit, `data-color-scheme` application, and explicit persistence.
- Move the accent tokens out of `tokens.css` into `styles/schemes.css` and
  import it after `tokens.css`.
- Extend `tests/styles.test.ts` with per-scheme contrast coverage and add
  `tests/colorScheme.test.ts`.
- Verification: `npx vitest run tests/styles.test.ts tests/colorScheme.test.ts`.

## Task 2: Header picker and surface polish

- Add `src/components/ColorSchemeSwitcher.vue` with a toggle button, an
  on-demand menu, Escape and outside-press handling, and swatches.
- Thread `colorScheme` and `changeColorScheme` through `AppHeader` and
  `HeaderActions`, and wire `useColorScheme` in `App.vue`.
- Add the `header.colorScheme` and `colorScheme.*` messages for both locales.
- Style the picker in `workbench.css`, including the compact breakpoints.
- Tint the scrollbar thumb from the accent in `base.css` and put the CJK faces
  ahead of the generic fallback in the `--font-ui` stack.
- Extend `tests/HeaderLocale.test.ts` with picker markup, localization, and
  menu-state coverage.
- Verification: `npx vitest run`.

## Task 3: Distribution and gate refresh

- Rebuild `apps/web/dist` with the four-file payload.
- Extend `scripts/webui-browser-smoke.mjs` with a scheme switch, a persistence
  assertion, and an accent-token assertion at every viewport.
- Verification: `npm run test:browser`, `scripts/webui-build-test.sh --test`,
  `scripts/apps-layout-test.sh`.

## Task 4: Documentation

- Document the scheme system and picker in `apps/web/README.md`.
- Keep the design and plan documents next to the existing specs.