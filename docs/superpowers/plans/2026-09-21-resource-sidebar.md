# Resource sidebar implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for isolated tasks and reviews. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the desktop sidebar into a VS Code-style resource manager
(Explorer with the four reference buttons, Search, Source Control, Remote
Explorer) and move the workbench onto pure black/white backgrounds, then verify
the shared and packaged UI and push.

**Architecture:** Grow the activity list with the three new views, back each one
with a small composable over a new validated Electron bridge capability, and
keep the run history and inspector as reachable views. Retune `tokens.css` so
the neutral surfaces are pure while borders, subtle surfaces, and muted text stay
readable.

**Tech Stack:** Vue 3, Electron 38, TypeScript, Vitest, Node tests, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-21-resource-sidebar-design.md`

## Global constraints

- Preserve `apps/{web,cli,desktop}` and the four-file WebUI payload.
- Keep browser, Pages, and desktop behavior aligned; no desktop-only UI fork.
- Test each behavior before claiming it works; never substitute a mock for the
  real interactive check.
- Focused commits, isolated worktrees, review integration, push only at the end.

## Task 1: Explorer header and folder creation

Files: `apps/web/src/components/ide/WorkspaceExplorer.vue`,
`apps/web/src/components/WorkbenchShell.vue`, `apps/web/src/composables/useWorkspace.ts`,
workspace store + `apps/desktop/src/workspace.mjs`, locales, explorer tests.

- [ ] Add the four reference header buttons in order: new file, new folder,
      refresh, collapse folders; keep the sidebar collapse control last.
- [ ] Implement collapse-all so every open directory folds at once.
- [ ] Create folders through the existing validated path, including nested
      names, and cover both store backends.
- [ ] Extend the new-file form with a target directory and cover the flow.

## Task 2: Workspace search

Files: new `apps/web/src/composables/useWorkspaceSearch.ts`, new
`apps/web/src/components/ide/WorkspaceSearch.vue`, `WorkbenchShell.vue`,
`apps/desktop/src/workspace.mjs`, `ipc.mjs`, `preload.cjs`, `desktopBridge.ts`,
locales, tests.

- [ ] Add a bounded, ignore-aware text search to `workspace.mjs` with a result
      cap and case sensitivity, and unit-test the walker against a real folder.
- [ ] Expose `sandkasten:workspace:search` through the IPC registry, the
      preload bridge, and the renderer types.
- [ ] Render results as files with line matches, report file/result counts and
      truncation, and open the file when a match is chosen.
- [ ] Report a useful message in the browser build, where search needs desktop.

## Task 3: Source control

Files: new `apps/desktop/src/source-control.mjs`, `ipc.mjs`, `preload.cjs`,
`desktopBridge.ts`, new `apps/web/src/composables/useSourceControl.ts`, new
`apps/web/src/components/ide/SourceControlView.vue`, `WorkbenchShell.vue`,
locales, tests.

- [ ] Run git with a fixed argument vector: detect the repository, list the
      branch, the porcelain status, and the recent log; never accept a flag or
      ref from the renderer.
- [ ] Add tests for a real temporary repository: clean, modified, staged,
      untracked, and a commit round trip.
- [ ] Render the branch, grouped changed files, the commit box, the commit
      action, the history graph, and refresh; disable what cannot run.
- [ ] Stage and commit through the bridge and refresh the view afterwards.

## Task 4: Remote explorer

Files: new `apps/desktop/src/remote.mjs`, `ipc.mjs`, `preload.cjs`,
`desktopBridge.ts`, new `apps/web/src/composables/useRemoteHosts.ts`, new
`apps/web/src/components/ide/RemoteExplorer.vue`, `WorkbenchShell.vue`, `App.vue`,
locales, tests.

- [ ] Parse the SSH config with a strict parser: first wins per key, comments and
      blank lines ignored, `Include` skipped, no value ever trusted as a path.
- [ ] List the hosts with their `HostName`/`User` and the directories known for
      each one, and unit-test the parser against a fixture.
- [ ] Render the SSH tree with per-host and per-directory entries and an empty
      state that explains what is missing.
- [ ] Hand a chosen entry to the terminal: open the panel with a session for that
      host and offer the directory as its working directory, per the confirmed
      choice; never browse remote files in-app.

## Task 5: Pure black/white surfaces

Files: `apps/web/src/styles/tokens.css`, `ide.css`, `workbench.css`, `base.css`,
`apps/desktop/src/navigation.mjs`, `styles.test.ts`, desktop chrome tests.

- [ ] Make the canvas, chrome, and raised surfaces pure white in light and pure
      black in dark, then re-derive borders, subtle surfaces, and muted text.
- [ ] Keep every existing contrast gate green, including file hues and semantic
      states, and update the desktop window-chrome colors to match.
- [ ] Cover the pure surfaces with a focused test so a later tint fails loudly.

## Task 6: Integration, QA, and delivery

Files: web dist, desktop E2E, browser smoke, README and design docs, completion
record.

- [ ] Review each branch diff and merge into the integration branch, resolving
      the shared `WorkbenchShell.vue` and `tokens.css` changes by preserving
      both behaviors.
- [ ] Run the complete web, desktop, CLI, and layout gates plus the browser
      smoke check.
- [ ] Extend the desktop E2E to the four sidebar views, the pure surfaces, and
      the remote hand-off, and run it with a fresh profile.
- [ ] Rebuild the four-file distribution, package and smoke the Windows build,
      record commands and results, then push the branches and main.
