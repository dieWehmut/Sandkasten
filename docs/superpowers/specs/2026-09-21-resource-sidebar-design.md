# VS Code-style sidebar: Explorer, Search, Source Control, Remote Explorer

This continues session `01a0c1cb-40ae-7920-bdea-870a267f0b37` and the four
supplied reference images. It rewrites the desktop sidebar so it reads like the
VS Code resource manager: one Explorer view with the four reference header
buttons, plus Search, Source Control (git), and Remote Explorer views, on
backgrounds that are pure black or pure white.

## Requested behavior

1. The sidebar is the resource manager. Its Explorer view carries the four
   header buttons from the reference, in order: new file, new folder, refresh,
   and "collapse folders in the explorer". A search entry follows.
2. A dedicated Search view searches the workspace for text and lists the
   matching files with their line matches, following reference image 2.
3. A Source Control (git) view reports the real repository state of the opened
   folder: the changed files, the commit message box, the commit action, and the
   recent history graph, following reference image 3.
4. A Remote Explorer view lists the configured SSH hosts and their directories
   as entries, following reference image 4. Per the confirmed choice, selecting
   a host or directory hands the connection to the terminal instead of browsing
   remote files in-app.
5. The workbench backgrounds are pure black or pure white: the canvas, chrome,
   sidebar, activity bar, and status bar stop being tinted, in both themes.

## Constraints

- `apps/{web,cli,desktop}` stay in place, and `apps/web/dist` stays exactly four
  files. Search, git, and SSH data must arrive over the existing Electron bridge
  rather than through new assets.
- Browser and Pages builds keep working. Views that need the desktop bridge
  explain what is missing instead of failing; they never fake data.
- Everything the sidebar already reached stays reachable: the run history, the
  inspector, the setup guide, the settings screen, and the terminal.
- `data-theme`, `data-color-scheme`, the stored preferences, and the WCAG checks
  remain the single source of truth for color. Pure surfaces must still clear
  the existing contrast gates, and file-type hues must stay readable on them.
- Test each behavior before claiming it works; never substitute a stub for a
  real interactive check.
- Focused commits, isolated worktrees, integration after the gates pass, and
  push only at the end.

## Architecture

**Activity bar.** `IdeActivity` grows from `explorer | runs | context` to
`explorer | search | source-control | remote | runs | context`, with the first
four matching the reference's icons: `Files`, `Search`, `GitBranch`, `Monitor`.
The footer keeps the settings button. Run history and the inspector stay
reachable as their own views so nothing is lost.

**Explorer.** `WorkspaceExplorer.vue` gains the reference's four header buttons:
new file, new folder, refresh, collapse folders. The new-file form grows a
directory field so a nested path can be created, and a folder is created with a
trailing separator through the same `create` store call. "Collapse folders"
folds every open directory at once.

**Search.** A new `WorkspaceSearch.vue` plus a `useWorkspaceSearch` composable
call `bridge.workspace.search(query)`, which walks the opened folder in the main
process with the same ignored-directory and size limits as the tree, and returns
`{ path, name, matches: [{ line, text }] }`. Results render as a tree of files
with their matching lines; selecting a line opens the file. The view reports how
many files and results it found, and truncates loudly rather than silently.

**Source control.** A new `source-control.mjs` desktop module runs `git` through
`execFile` with a fixed argument vector: `rev-parse --is-inside-work-tree`,
`status --porcelain=v1 -z`, `log --oneline`, `add`, and `commit -m`. It never
builds a shell string and never accepts a ref or flag from the renderer. A new
`SourceControl.vue` shows the branch, the changed files with their status
letters, a commit message box, a commit action, and the recent history.

**Remote explorer.** A new `remote.mjs` desktop module parses the user's SSH
config with a strict parser (first-wins per key, `Include` ignored), lists the
host aliases with their `HostName`/`User`, and pairs them with the directories
that are known for that host (`~/.ssh` is never modified). Selecting an entry
hands the session to the real terminal: it opens the terminal panel with a new
session whose profile matches the host's transport (`ssh` on POSIX,
`ssh.exe`/`cmd` on Windows), and the directory is offered as its working
directory. No remote filesystem browsing happens in-app.

**Pure surfaces.** `tokens.css` sets `--canvas`, `--chrome`, and the raised
surfaces to `#ffffff` in light and `#000000` in dark, then re-derives borders,
subtle surfaces, and the muted text ramp so the existing contrast tests still
pass. The native window chrome and the activity-bar/sidebar backgrounds follow.

## Verification and delivery

Each task gets focused tests before the implementation and its own commits on
its own branch: web component/composable tests in Vitest, desktop module tests
in `node --test`, the contrast gates in `styles.test.ts`, and the `preload`
channel-parity test. The integration branch assembles them, rebuilds the
four-file distribution, extends the desktop E2E and the browser smoke run to the
new views and surfaces, and pushes every branch and `main` only once the full
set passes.
