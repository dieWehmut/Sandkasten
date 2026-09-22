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

- [x] Add the four reference header buttons in order: new file, new folder,
      refresh, collapse folders; keep the sidebar collapse control last.
- [x] Implement collapse-all so every open directory folds at once.
- [x] Create folders through the existing validated path, including nested
      names, and cover both store backends.
- [x] Extend the new-file form with a target directory and cover the flow.

## Task 2: Workspace search

Files: new `apps/web/src/composables/useWorkspaceSearch.ts`, new
`apps/web/src/components/ide/WorkspaceSearch.vue`, `WorkbenchShell.vue`,
`apps/desktop/src/workspace.mjs`, `ipc.mjs`, `preload.cjs`, `desktopBridge.ts`,
locales, tests.

- [x] Add a bounded, ignore-aware text search to `workspace.mjs` with a result
      cap and case sensitivity, and unit-test the walker against a real folder.
- [x] Expose `sandkasten:workspace:search` through the IPC registry, the
      preload bridge, and the renderer types.
- [x] Render results as files with line matches, report file/result counts and
      truncation, and open the file when a match is chosen.
- [x] Report a useful message in the browser build, where search needs desktop.

## Task 3: Source control

Files: new `apps/desktop/src/source-control.mjs`, `ipc.mjs`, `preload.cjs`,
`desktopBridge.ts`, new `apps/web/src/composables/useSourceControl.ts`, new
`apps/web/src/components/ide/SourceControlView.vue`, `WorkbenchShell.vue`,
locales, tests.

- [x] Run git with a fixed argument vector: detect the repository, list the
      branch, the porcelain status, and the recent log; never accept a flag or
      ref from the renderer.
- [x] Add tests for a real temporary repository: clean, modified, staged,
      untracked, and a commit round trip.
- [x] Render the branch, grouped changed files, the commit box, the commit
      action, the history graph, and refresh; disable what cannot run.
- [x] Stage and commit through the bridge and refresh the view afterwards.

## Task 4: Remote explorer

Files: new `apps/desktop/src/remote.mjs`, `ipc.mjs`, `preload.cjs`,
`desktopBridge.ts`, new `apps/web/src/composables/useRemoteHosts.ts`, new
`apps/web/src/components/ide/RemoteExplorer.vue`, `WorkbenchShell.vue`, `App.vue`,
locales, tests.

- [x] Parse the SSH config with a strict parser: first wins per key, comments and
      blank lines ignored, `Include` skipped, no value ever trusted as a path.
- [x] List the hosts with their `HostName`/`User` and the directories known for
      each one, and unit-test the parser against a fixture.
- [x] Render the SSH tree with per-host and per-directory entries and an empty
      state that explains what is missing.
- [x] Hand a chosen entry to the terminal: open the panel with a session for that
      host and offer the directory as its working directory, per the confirmed
      choice; never browse remote files in-app.

## Task 5: Pure black/white surfaces

Files: `apps/web/src/styles/tokens.css`, `ide.css`, `workbench.css`, `base.css`,
`apps/desktop/src/navigation.mjs`, `styles.test.ts`, desktop chrome tests.

- [x] Make the canvas, chrome, and raised surfaces pure white in light and pure
      black in dark, then re-derive borders, subtle surfaces, and muted text.
- [x] Keep every existing contrast gate green, including file hues and semantic
      states, and update the desktop window-chrome colors to match.
- [x] Cover the pure surfaces with a focused test so a later tint fails loudly.

## Task 6: Integration, QA, and delivery

Files: web dist, desktop E2E, browser smoke, README and design docs, completion
record.

- [x] Review each branch diff and merge into the integration branch, resolving
      the shared `WorkbenchShell.vue` and `tokens.css` changes by preserving
      both behaviors.
- [x] Run the complete web, desktop, CLI, and layout gates plus the browser
      smoke check.
- [x] Extend the desktop E2E to the four sidebar views, the pure surfaces, and
      the remote hand-off, and run it with a fresh profile.
- [x] Rebuild the four-file distribution, package and smoke the Windows build,
      and record the commands and results (see the record below).
- [x] Push the branches and main.

## Verification record

Every gate ran on the integration branch with the worktree's own dependencies:

| Gate | Command | Result |
| --- | --- | --- |
| Web suite (serial) | `npx vitest run --no-file-parallelism` in `apps/web` | 276 passed, 41 files |
| Desktop suite | `node --test tests/*.test.mjs` in `apps/desktop` | 146 passed |
| CLI suite | `node --test tests/*.test.mjs` in `apps/cli` | 19 passed |
| Apps layout | `bash scripts/apps-layout-test.sh` | ok |
| WebUI build contract | `bash scripts/webui-build-test.sh --test` | ok |
| Pages artifact | `bash scripts/pages-artifact-test.sh` | ok |
| Repository path | `bash scripts/repository-path-test.sh` | ok |
| Browser smoke | `npm run test:browser` in `apps/web` | 3 viewports passed |
| Desktop E2E | `npm run e2e` in `apps/desktop` | passed, development mode |
| Packaged E2E | `SANDKASTEN_E2E_EXECUTABLE=<unpacked exe> npm run e2e` | passed, packaged mode |

The E2E run proves the four sidebar views against real data: the explorer's five
header controls, a real search hit that opens its file, a git branch with its
changed file, a commit that reaches the history and leaves a clean tree, and an
SSH host that opens a terminal session with the composed ssh line. It also
asserts the pure white surfaces in light mode.

`npx tsc --noEmit` reports the same 30 pre-existing test-only errors as `main`
(no new errors from this work), and the serial web run is the authoritative one:
the default parallel run can starve the timer-based suites on a loaded machine.

## Delivery boundary

The pushed state is `main` carrying this plan's delivery merges — the
integration merge, the glyph correction, and this record — plus the six feature
branches
(`feat/resource-explorer`, `feat/workspace-search`, `feat/remote-explorer`,
`feat/source-control`, `fix/pure-black-white-surfaces`, and
`feat/resource-sidebar-integration`). The Pages workflow deploys the pushed
revision.

The corrected terminal glyph is part of that state: `df527a1` renamed the
lucide import but left the template tag reading `TerminalSquare`, so the
session row shipped a blank spot. `87265d9` fixes the tag, adds
`componentImports.test.ts` to fail on any unimported PascalCase tag, and
rebuilds the four-file distribution; the packaged payload was rebuilt and
re-verified from that revision.

## Follow-up: inline creation at the selection

Reference images 1 and 2 show the row opening *inside* the tree, under the
selected folder, and asking for a name only. The delivered explorer rendered
both forms as full-width blocks at the top of the panel with a second
"target folder" field, so this follow-up replaces that placement.

- [x] Take a slot in the tree's own row list, under the selected directory or
      beside the selected file, and unfold the directories above it.
- [x] Drop the target-folder field: the location comes from the selection, while
      a typed path still nests.
- [x] Land a selection-less open (welcome, native `Ctrl+N`) at the root.
- [x] Keep one row per directory: the creation row sits between the directory
      and file branches, so the file branch names its own condition.
- [x] Follow the header button that was pressed: new folder switches an open
      file row, and each button reports its own pressed state.
- [x] Cover the placement, the switch, the single-row tree, and the folder row
      in the WebUI suite and the desktop E2E, and capture the row visually.

## Follow-up verification record

| Gate | Command | Result |
| --- | --- | --- |
| WebUI suite | `npx vitest run` in `apps/web` | 283 passed, 41 files |
| Desktop suite | `npm test` in `apps/desktop` | 146 passed |
| Browser smoke | `npm run test:browser` in `apps/web` | passed, 3 viewports |
| Build contract | `bash scripts/webui-build-test.sh` | ok |
| Apps layout | `bash scripts/apps-layout-test.sh` | ok |
| Dev E2E | `npm run e2e` in `apps/desktop` | passed, development mode |
| Packaged smoke | `npm run package:win` + `npm run verify:installer` | 2 payloads, 0 problems |
| Packaged E2E | `SANDKASTEN_E2E_EXECUTABLE=<unpacked exe> npm run e2e` | passed, packaged mode |

The E2E asserts the row's parent (`pkg`), that it renders inside `.ide-tree`,
that a created file and folder land in `pkg`, that neither reaches the workspace
root, and that the folder button switches an open file row. Both the loose and
the packaged payload were rebuilt from the fixed source and hash-matched against
`apps/web/dist`, and the machine's installed build was refreshed from the
verified installer.

## Follow-up: the reference Git view and colored code highlighting

The reference screenshot is VS Code's Source Control panel: a rail of
commit dots down the left of the history, a filled dot per commit, an
outlined ring on the checked-out commit, the branch and tag names as badges
beside the tip, and each row naming the author. Two gaps separated the
delivered workbench from that picture, and the second was a defect rather
than a missing feature.

- [x] Read the three extra git fields the graph needs -- `%D` decorations,
      `%P` parents, and `%ct` committer time -- through the existing fixed
      argument vector, and normalize the decorations to names plus an
      `isHead` marker.
- [x] Lay the lanes out in a pure module: one lane per open line, a lane
      reused rather than duplicated for a parent that already has one, and
      no lane left open below the commit it was waiting for.
- [x] Draw the rail in the view: a line per lane that enters or leaves the
      row, a curve where the commit joins a parent in another lane, the HEAD
      ring, and ref badges, with the author and the elapsed time in the row.
- [x] Repair `ide.css`: the merge that integrated source control dropped the
      closing brace of `.ide-remote`, so every rule after it -- the whole
      remote tree and all of source control -- was nested inside a selector
      that never matched. Rebuild the file from the two merge parents.
- [x] Fail loudly on that class of mistake: count braces in every stylesheet
      and assert the component blocks open at the top level.
- [x] Wire a parser for every extension the explorer names a language, so a
      file the tree labels with a language icon is not rendered as flat text.
- [x] Prove the tokens are real colors rather than a wired-but-inert parser:
      the probe counts the distinct colors the editor paints per language.

### Verification record

| Gate | Command | Result |
| --- | --- | --- |
| WebUI suite (serial) | `npx vitest run --no-file-parallelism` in `apps/web` | 291 passed, 42 files |
| Desktop suite | `npm test` in `apps/desktop` | 147 passed |
| CLI suite | `npm test` in `apps/cli` | 19 passed |
| Apps layout | `bash scripts/apps-layout-test.sh` | ok |
| WebUI build contract | `bash scripts/webui-build-test.sh --test` | ok |
| Pages artifact | `bash scripts/pages-artifact-test.sh` | ok |
| Repository path | `bash scripts/repository-path-test.sh` | ok |
| Browser smoke | `npm run test:browser` in `apps/web` | 3 viewports passed |
| Desktop E2E | `node scripts/e2e-ide.mjs` in `apps/desktop` | passed, `rendererErrors: []` |
| Graph probe | `node scripts/probe-git-view.mjs` in `apps/desktop` | rail, HEAD ring, `main`/`topic` badges, light and dark |
| Highlight probe | `node scripts/probe-highlight.mjs` in `apps/desktop` | 2-9 distinct token colors per language |

The E2E records one rail per commit, exactly one HEAD row (the newest), the
`main` badge on the checked-out branch, and a lane index for every row, and
it asserts them. The probes report what the renderer painted: the graph in
both themes, and an editor that now colors markdown, CSS, HTML, YAML, SQL,
shell, and Vue files that previously rendered as one flat color.
