# Desktop Refinement Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for isolated tasks and reviews. Steps use checkboxes to track progress.

**Goal:** Finish all five requests from the continued session, verify the shared and packaged UI, and push the completed work.

**Architecture:** Keep the shared Vue workbench and add a desktop-only PTY bridge. Isolate terminal hosting, terminal rendering, and welcome changes on separate branches; the integration branch owns setup scrolling, error-banner removal, and end-to-end verification.

**Tech Stack:** Vue 3, Electron 38, TypeScript, Node.js, node-pty, xterm.js, Vitest, Node tests, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-19-desktop-refinement-design.md`

## Global constraints

- Preserve `apps/{web,cli,desktop}` and the four-file committed WebUI payload.
- Native terminal operations remain behind the sandboxed CommonJS preload.
- Browser builds have no local shell capability.
- Test each behavior before claiming it works; never substitute a mock shell for interactive PTY verification.
- Focused commits, isolated worktrees, review integration, push only after completion.

## Task 1: Audit the existing tray change

Files: `apps/desktop/src/tray.mjs`, `apps/desktop/tests/tray.test.mjs`, desktop README and existing IDE design.

- [x] Review `ae0d440` against the request in both locales.
- [x] Run `node --test tests/tray.test.mjs tests/menu.test.mjs tests/preload.test.mjs` in `apps/desktop`.
- [x] Keep the existing focused commit; correct only verified omissions.

## Task 2: Setup scroll and connection banner

Files: `apps/web/src/App.vue`, `apps/web/tests/appLocaleSetup.test.ts`, `apps/desktop/scripts/e2e-refinement.mjs`.

- [x] Reproduce wheel scrolling against the built guide in an isolated Electron profile.
- [x] Add an App regression assertion that the IDE viewport lock is absent while setup is shown and restored after dismissal/reopen.
- [x] Apply the viewport class only when the IDE workbench is visible; keep compact scrolling unchanged.
- [x] Assert failed runtime loading leaves the disconnected connection status and endpoint settings but no `.connection-error` strip.
- [x] Remove the banner template and obsolete style rules; run focused App tests and commit each correction separately.

## Task 3: Quiet empty editor

Files: `apps/web/src/components/ide/EditorWelcome.vue`, `apps/web/src/components/WorkbenchShell.vue`, focused welcome CSS/locales and tests.

- [x] Add component tests for no-file rendering, locale, platform shortcuts, and emitted actions.
- [x] Show a subdued existing brand mark and real new-file/open-folder/setup actions; display shortcuts only for implemented commands.
- [x] Hide empty editor toolbar/breadcrumbs and render the welcome in their place.
- [x] Verify opening a file restores the full editor and closing its last tab restores welcome; commit the deliverable.

## Task 4: PTY host and native bridge

Files: new desktop terminal host/profile/IPC modules, `main.mjs`, `preload.cjs`, `ipc.mjs`, menu, dependency lockfile and packaging configuration, terminal tests.

- [x] Write host tests for persistent shell input/output, resize, interrupt, concurrent IDs, process exit/cleanup, and invalid requests.
- [x] Implement the terminal bridge signatures in the spec; use a trusted bundled renderer and per-owner sessions.
- [x] Discover installed shell profiles with bounded probes; reject unknown IDs and oversized inputs/dimensions.
- [x] Add buffering/attachment handling so output before UI attachment is retained.
- [x] Test real node-pty on this Windows host and include native artifacts for both supported installer architectures.
- [x] Commit the host, bridge, and packaging in focused slices with passing checks.

## Task 5: Terminal UI

Files: terminal Vue components, composable, CSS, desktop bridge types, `WorkbenchShell.vue`, `App.vue`, localized strings, frontend dependency lockfile and tests.

- [x] Test session creation, switching, split/unsplit, close, retained state, event subscription disposal, failed creation, and browser absence.
- [x] Implement xterm.js plus fit addon against the spec bridge; render real data and forward input/resize.
- [x] Add bottom output/terminal tabs and native menu/keyboard actions for new terminal and terminal visibility.
- [x] Keep processes and buffers when hiding panels or opening setup. Map terminal shortcuts without stealing normal shell input.
- [x] Verify locale/theme updates, responsive bounds, and existing output behavior; commit focused units.

## Task 6: Integration, QA, and delivery

Files: desktop/browser E2E scripts, desktop README, updated design, built web dist, completion record.

- [x] Review each branch diff and merge into the integration branch, resolving shared WorkbenchShell/App changes by preserving both behaviors.
- [x] Run complete frontend and desktop tests, CLI/layout gates, browser smoke, and existing desktop IDE E2E.
- [x] Run refinement E2E with a fresh profile: scroll to setup bottom at large/small sizes, dismiss/reopen, welcome actions, no failure strip, real terminal prompt, persistent cwd/state, Ctrl+C, split, resize, close, and app cleanup.
- [x] Build Windows installers and verify native payload plus packaged terminal E2E; visually inspect light/dark screenshots.
- [x] Record exact commands/results, complete final review, commit generated dist/docs, merge main and push the completed branches/main.
