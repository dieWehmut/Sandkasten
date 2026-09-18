# Desktop IDE Workbench Design

## Context

`apps/desktop` is an Electron shell that loads the committed `apps/web/dist`
payload. It reused the browser workbench as-is: a three-column runner with a
history sidebar, a single source editor, and an inspector. The desktop request is
an editor-first application — open a folder, edit several files, run one — with
the VS Code arrangement but a deliberately plain surface.

This design keeps one UI. The IDE shell lives in the shared Vue bundle, and the
desktop build adds the capabilities a browser cannot have through a narrow
preload bridge. GitHub Pages therefore ships the same code path, with the file
explorer backed by an in-memory scratch workspace and execution limited to the
sandboxed API.

## Goals

- Editor-first layout: activity bar, sidebar, open-file tabs, editor, bottom
  output panel, status bar.
- A real workspace folder in the desktop build: open, list, read, write, create,
  delete, bounded and confined to that folder.
- Run code from the workbench with two backends: the sandboxed Sandkasten API and
  the local toolchains installed on the machine.
- Keep the existing browser behaviour, tests, and the four-file distribution
  contract intact.

## Non-goals

- No language server, debugging, multi-root workspaces, or extensions.
- No terminals, package installation, or network access from local runs.
- No sandboxing of local runs: the desktop app executes workspace files with the
  user's own toolchain, and the UI says so.

## Layout

Desktop (≥1200 px) renders `workbench-shell layout-ide`:

```
app-header (unchanged: brand, connection, header actions)
├ activity bar (48 px)  explorer | runs | inspector | setup guide
├ sidebar (248 px)      workspace tree + recent runs, or the selected activity
└ main
  ├ editor tabs
  ├ editor toolbar      runtime select · execution backend · save · run/stop
  ├ editor              CodeMirror
  ├ job timeline        phase / error strip
  ├ output panel        Output · Errors · Compile · Diagnostics
  └ status bar          backend badge · workspace · file · language · status · cursor
```

Narrower windows keep the existing single-column layout with history and
inspector sheets, so the mobile and tablet contracts are unchanged.

The activity bar follows the editor-first rule: selecting the active activity
collapses the sidebar instead of re-rendering it. Menu commands and `Ctrl+N`
force the explorer visible again.

## Workspace model

`useWorkspace` owns open files, the active file, the tree, and the dirty state.
`WorkspaceFile` is `{ path, name, language, source, dirty }`; `language` is
resolved from the extension through `languageForPath` and can be overridden per
file from the runtime selector.

Two stores implement one async contract (`root`, `openFolder`, `list`, `read`,
`write`, `create`, `remove`):

- `createMemoryWorkspaceStore` — a flat scratch workspace seeded with `main.py`
  and persisted under `sandkasten-workspace-v1`.
- `createDesktopWorkspaceStore` — the preload bridge over a real folder.

Open files are tabs. Closing the active tab activates its neighbour, `Ctrl+S`
writes the buffer, and history selection (a Sandkasten API feature) writes the
recorded source back into the active buffer as an unsaved change.

## Execution backends

Both backends project onto one `ExecutionPhase` union and produce a
`JobResponse`-shaped result, so `OutputTabs`, `OutputViewer`, `JobTimeline`, and
the status bar are backend-agnostic.

| | Sandboxed API | Local |
| --- | --- | --- |
| Owner | `useRunner` (remote jobs, polling, history) | `useLocalRunner` (desktop only) |
| Input | active file source over HTTP | the file on disk |
| Availability | runtime list from `/v1/runtimes` | detected toolchains on the machine |
| Isolation | Linux sandbox | none |

`runActive` saves dirty desktop buffers before a local run, because the local
runner executes the file rather than a buffer. Run history is shared through one
`useRunHistory` instance injected into both runners.

Local execution maps canonical runtime names to fixed commands
(`python {file}`, `node {file}`, `go run {file}`, `rustc {file} -o {exe}` then
`{exe}`, `gcc`/`g++`, `java {file}`, `ruby`, `php`, `bash`, `lua`, `perl`) with a
20 s default timeout, a 120 s ceiling, a 1 MiB output cap, true cancellation, and
temporary build directories that are removed after the run.

## Desktop bridge

`contextIsolation: true` and `sandbox: true` stay enabled, so the bridge lives in
a CommonJS preload (`src/preload.cjs`); sandboxed preloads cannot be ES modules.

```
window.sandkastenDesktop = {
  platform, versions,
  workspace: { openFolder, root, list, read, write, create, remove },
  runner: { detect, run, stop },
  onMenuCommand(handler),
}
```

Main-process boundary:

- `workspace.mjs` resolves every relative path against the opened root, rejects
  absolute paths, `..` segments, and NUL bytes, skips VCS/build directories, caps
  the tree at 6 levels / 2000 entries, and caps files at 2 MiB.
- `local-runner.mjs` owns detection, plans, spawning, output capture, timeouts,
  cancellation, and the temp build directory.
- `ipc.mjs` validates every argument and requires an open folder before any file
  or run request; `tests/preload.test.mjs` keeps the preload channel names in
  sync with the IPC registry.
- `menu.mjs` forwards stable command ids (`workspace.open`, `file.save`,
  `run.start`, `view.togglePanel`, …) so the menu and the page share one handler
  table in the renderer.

The last opened folder is stored in `workspace.json` under the Electron
user-data directory; `SANDKASTEN_WORKSPACE_ROOT` overrides it for scripted runs.

## Keyboard and menu

| Action | Shortcut |
| --- | --- |
| Run active file | `Ctrl+Enter` / `F5` |
| Save file | `Ctrl+S` |
| New file | `Ctrl+N` |
| Close editor | `Ctrl+W` |
| Toggle sidebar | `Ctrl+B` |
| Toggle output panel | `Ctrl+J` |

## Verification

- `apps/web/tests/ide.test.ts` covers the store, layout state, explorer tree,
  tabs, local run, backend switching, save/create/delete, and menu commands.
- `apps/desktop/tests/*.test.mjs` cover the path guard, tree limits, local run
  lifecycle (success, compile failure, timeout, cancel, truncation), IPC
  validation, the menu template, and the preload contract.
- `npm run e2e` in `apps/desktop` launches the real app against a temporary
  workspace, asserts the tree, a local Python run, `Ctrl+S` persistence, file
  creation, panel toggling, and both themes, and writes light/dark screenshots.
  `SANDKASTEN_E2E_EXECUTABLE` runs the same script against a packaged build.