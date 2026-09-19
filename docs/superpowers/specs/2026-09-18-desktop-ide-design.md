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
- Keep the surface plain and pink by default: the accent scheme is
  deterministic (`pink`) on a first visit, and the shell never grows the
  document, so every region stays reachable with the wheel.

## Non-goals

- No language server, debugging, multi-root workspaces, or extensions.
- No package installation UI or network access from local runs. Interactive
  terminals were added by the follow-up desktop refinement design and use the
  user's normal local shell permissions.
- No sandboxing of *local* runs: that backend executes workspace files with the
  user's own toolchain, and the UI says so. The isolated backend is the
  sandboxed desktop path and needs WSL2.

## Layout

Desktop (≥1200 px) renders `workbench-shell layout-ide`:

```
app-header (unchanged: brand, connection, header actions)
├ activity bar (48 px)  explorer | runs | inspector | setup guide
├ sidebar (248 px)      header: view title · view actions · collapse
│                       workspace tree + recent runs, or the selected activity
└ main
  ├ editor tabs
  ├ editor toolbar      runtime select · execution backend · save · run/stop
  ├ body (scrolls)      editor · job timeline · output panel
  └ status bar (pinned)
```

Narrower windows keep the existing single-column layout with history and
inspector sheets, so the mobile and tablet contracts are unchanged.

The activity bar follows the editor-first rule: selecting the active activity
collapses the sidebar instead of re-rendering it. The sidebar header owns the
view title, the view actions, and an explicit collapse control placed flush with
its top-right corner, so the sidebar can always be collapsed from inside itself.
Menu commands and `Ctrl+N` force the explorer visible again.

### Viewport contract

The IDE shell is bounded to the viewport (`height: 100dvh`, `overflow: hidden`,
`flex: 1 1 0`) instead of growing with its content. Tree, editor, and output
panel therefore scroll inside their own panes with the mouse wheel, the status
bar stays pinned to the bottom edge, and the document never gains a scrollbar —
a large workspace or a verbose program cannot push the panel or the status bar
out of reach. Every scroll container also sets `overscroll-behavior: contain`
so a wheel gesture never chains into the surrounding layout. The compact layouts
keep document-level scrolling, which they were designed around.

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

All three backends project onto one `ExecutionPhase` union and produce a
`JobResponse`-shaped result, so `OutputTabs`, `OutputViewer`, `JobTimeline`, and
the status bar are backend-agnostic.

| | Sandboxed API | Local | Isolated |
| --- | --- | --- | --- |
| Owner | `useRunner` (remote jobs, polling, history) | `useLocalRunner` (desktop only) | `useLocalRunner` (desktop only) |
| Input | active file source over HTTP | the file on disk | the file on disk |
| Availability | runtime list from `/v1/runtimes` | detected toolchains on the machine | a WSL2 distro that creates the namespaces |
| Isolation | Linux sandbox | none | user, network, and PID namespaces |

`runActive` saves dirty desktop buffers before a local run, because the local
runner executes the file rather than a buffer. Run history is shared through one
`useRunHistory` instance injected into both runners.

The local and isolated backends share one controller (`useLocalRunner`), so they
reuse its phase, history, and result bookkeeping and the shell renders them
identically. A canceled isolated run reports `JOB_STATUS_CANCELED` through the
same path as a canceled local run.

Isolated runs map canonical runtime names to the binary inside the distro
(`python` → `python3`, `javascript`/`typescript` → `node`) and execute
`unshare --user --map-root-user --net --pid --fork --mount-proc` in the file's
own folder. The backend reports itself unavailable unless the probe confirms
both that a PID namespace was created and that a network connection fails inside
the network namespace, so a machine without WSL2 degrades to two backends.

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
  isolated: { detect, run, stop },
  onMenuCommand(handler),
}
```

Main-process boundary:

- `workspace.mjs` resolves every relative path against the opened root, rejects
  absolute paths, `..` segments, and NUL bytes, skips VCS/build directories, caps
  the tree at 6 levels / 2000 entries, and caps files at 2 MiB.
- `local-runner.mjs` owns detection, plans, spawning, output capture, timeouts,
  cancellation, and the temp build directory.
- `isolated-runner.mjs` owns the WSL2 probe, the namespace invocation, path
  translation to the `/mnt/<drive>` mount, wsl.exe stderr noise, and the same
  timeout/cancellation contract over `wsl.exe`.
- `ipc.mjs` validates every argument and requires an open folder before any file
  or run request; `tests/preload.test.mjs` keeps the preload channel names in
  sync with the IPC registry.
- `menu.mjs` forwards stable command ids (`workspace.open`, `file.save`,
  `run.start`, `view.togglePanel`, …) so the menu and the page share one handler
  table in the renderer.

The last opened folder is stored in `workspace.json` under the Electron
user-data directory; `SANDKASTEN_WORKSPACE_ROOT` overrides it for scripted runs.

## Window chrome and the tray

The window runs with `titleBarStyle: 'hidden'`, so the renderer paints the
whole title row: the brand, the five application menus, the composed window
title, and the header actions. The row is 40 px tall to match the native
overlay and reserves the caption-button inset so dragging never covers the
window controls. macOS keeps its traffic lights and the system menu.

`windowChrome` is the only surface that can change native chrome. Both
handlers require the trusted bundled top-level frame, so a subframe or a
remote URL cannot restyle the window or pop a menu. `chromeShowMenu` validates
the menu id, the locale, and the anchor (scaled by the zoom factor) before it
builds the submenu with `Menu.buildFromTemplate` and pops it below the
button; the renderer keeps the button expanded until the popup reports that it
closed. The native overlay colors follow the active theme through
`chromeSetTheme`, which also repaints the window background.

Closing the window hides it into the taskbar tray instead of ending the app,
so a running job keeps going. `tray.mjs` builds the tray from the shared brand
mark and owns the only real exit: a left click restores and focuses the
window, a right click opens a small localized settings menu (setup guide, API
endpoint), and its quit entry calls `app.quit()`. `before-quit` marks
the app as quitting so the close handler stops hiding the window, which keeps
the packaged smoke run and the OS shutdown sequence working.

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
  tabs, the sidebar header and collapse control, the scrolling body, local run,
  backend switching, save/create/delete, and menu commands.
- `apps/web/tests/colorScheme.test.ts` pins pink as the deterministic default
  and asserts that a first visit stores nothing.
- `apps/desktop/tests/*.test.mjs` cover the path guard, tree limits, local run
  lifecycle (success, compile failure, timeout, cancel, truncation), IPC
  validation, the menu template, the preload contract, and window chrome.
- `apps/desktop/tests/window-chrome.test.mjs` covers overlay theming, the frame
  and payload validation, and the menu popup anchor; `apps/desktop/tests/tray.test.mjs`
  covers the tray clicks, the localized settings menu, and close-to-tray.
- `npm run e2e` in `apps/desktop` launches the real app against a temporary
  workspace and asserts the tree, a local Python run, `Ctrl+S` persistence, file
  creation, panel toggling, wheel scrolling in the tree/editor/panel with the
  document staying bounded, the collapse-button geometry, the 40 px integrated
  title row with its drag region and native menu popup, close-to-tray so the
  window hides without ending the app, the default accents in both themes, and
  the minimum window; it writes light/dark screenshots.
  `SANDKASTEN_E2E_EXECUTABLE` runs the same script against a packaged build.
- `npm run test:browser` in `apps/web` drives installed Chrome against the built
  distribution at 1440x900, 1024x768, and 390x844, asserting the four primary
  regions, no horizontal overflow, no overlapping controls, scheme switching,
  and the run/output flow.
