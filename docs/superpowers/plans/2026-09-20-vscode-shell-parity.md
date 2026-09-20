# VS Code shell parity implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for isolated tasks and reviews. Steps use checkboxes to track progress.

**Goal:** Ship the vscode-icons glyph set, the reduced VS Code-style title row with
back/forward and a centered search, and the new settings screen, then verify the
shared and packaged UI and push.

**Architecture:** Generate the icon table from the pinned upstream manifests and
inline the chosen SVGs. Replace the header's action cluster with a brand mark, a
history pair, and a command center, and move the displaced controls into a
settings view owned by the shared app shell.

**Tech Stack:** Vue 3, Electron 38, TypeScript, Vitest, Node tests, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-20-vscode-shell-parity-design.md`

## Global constraints

- Preserve `apps/{web,cli,desktop}` and the four-file WebUI payload.
- Keep browser, Pages, and desktop behavior aligned; no desktop-only UI fork.
- Test each behavior before claiming it works; never substitute a mock for the
  real interactive check.
- Focused commits, isolated worktrees, review integration, push only at the end.

## Task 1: vscode-icons glyphs

Files: icon table generator and generated data under `apps/web/src/editor/`,
`FileIcon.vue`, explorer/tabs/breadcrumbs call sites, icon tests.

- [x] Generate the extension, file-name, and folder-name maps plus the inlined
      SVG table from the pinned upstream manifests.
- [x] Resolve a file or folder path to its upstream icon id, falling back to the
      neutral default for unknown names.
- [x] Render the real glyph in the explorer, tabs, and breadcrumbs for both
      themes, and keep the tree aligned with the previous icon box size.
- [x] Cover extension, exact file name, folder name, and unknown-file cases.
- [x] Commit the table, the component, and the call sites in focused slices.

## Task 2: Title row reduction

Files: `AppHeader.vue`, `HeaderActions.vue`, `App.vue`, `menu.mjs`, header
styles, desktop menu tests, header tests.

- [x] Show only the brand mark, drop the wordmark, and remove the Run menu from
      the native menu template while keeping run/stop reachable.
- [x] Delete the connection status, setup, locale, history, inspector, and theme
      controls from the title row and their now-dead styles.
- [x] Keep the window title, the native menus, and the drag region intact.
- [x] Update the header, menu, and accessibility tests to the reduced row.

## Task 3: Back/forward history

Files: new history composable, `App.vue`, header arrows and styles, tests.

- [x] Record the active editor path in a bounded history as files open.
- [x] Render back and forward arrows next to the brand mark, disabled when no
      step is available, with localized labels and accelerators.
- [x] Restore the target file from each arrow and assert the button state after
      opening, closing, and navigating.

## Task 4: Command center

Files: new command center component and composable, `App.vue`, locales, styles,
tests.

- [x] Collect the real commands with their accelerators plus workspace files.
- [x] Center the search control in the title row, open the palette with
      `Ctrl+E`/`Ctrl+P` and from the control, and close it with Escape or an
      outside click.
- [x] Support keyboard navigation, run the highlighted command or open the
      highlighted file, and never list commands the app cannot perform.
- [x] Track recently opened files and show them before any query.

## Task 5: Settings screen

Files: settings view, sections, search, appearance controls, locales, styles,
tests, desktop menu, activity bar.

- [x] Replace the activity-bar setup button with a settings button that opens the
      settings view; keep the setup guide reachable from the native menu.
- [x] Render the section sidebar with the search box and the appearance section
      from the reference: theme previews for system/light/dark, accent color,
      background, and foreground.
- [x] Make the theme choice, accent, and background/foreground persist and apply
      to the running workbench, and add the missing `system` theme mode.
- [x] Move the API endpoint and color scheme controls into the settings view so
      the removed header buttons keep an entry point.
- [x] Filter sections from the settings search.

## Task 6: Integration, QA, and delivery

Files: web dist, desktop E2E, README and design docs, completion record.

- [x] Review each branch diff and merge into the integration branch, resolving
      the shared `App.vue` changes by preserving both behaviors.
- [x] Run the complete web, desktop, CLI, and layout gates plus the browser
      smoke check.
- [x] Extend the desktop E2E for the reduced title row, the palette, the
      settings screen, and the removed controls, and run it with a fresh profile.
- [x] Rebuild the four-file distribution, package and smoke the Windows build,
      record commands and results, then push the branches and main.