# Sandkasten Desktop

An Electron workbench that loads the built `apps/web` distribution from disk. It
is the editor-first desktop build of the same WebUI published to GitHub Pages:
an activity bar, a workspace file explorer, open-file tabs, a CodeMirror editor,
an output panel, and a status bar — the VS Code arrangement, kept deliberately
plain.

The window is bounded to the viewport: the file tree, the editor, and the output
panel scroll inside their own panes with the mouse wheel, while the activity bar
and the status bar stay pinned and the document never grows. The sidebar header
carries the view actions and a collapse control at its top-right corner, next to
`Ctrl+B`. The accent scheme matches the browser build.

The window icon, the packaged executable, and every shortcut use one brand
mark, generated from the source artwork into `build/icon.ico` (multi-size)
and `build/icon.png` (512 px, also staged into the packaged resources).

The desktop build adds these things the browser cannot do:

1. **A real workspace folder.** `File > Open Folder…` (or the explorer button)
   picks a directory with the native dialog; files are listed, opened, edited,
   created, and deleted on disk, and `Ctrl+S` writes the buffer back.
2. **Local execution.** `Run` executes the active file with the toolchain
   installed on this computer (`python`, `node`, `go`, `rustc`/`gcc`/`g++`,
   `java`, `ruby`, `php`, `bash`, `lua`, `perl`), unsandboxed, with a 20 s
   default timeout and a 1 MiB output cap. The status bar always shows which
   backend ran the code (`Local run` vs `Sandbox API`); the same strip also
   reports the connection, the open file, the problems of the last run, the
   cursor, the detected indentation and line ending, the encoding, and the
   language mode.
3. **Isolated execution.** `Execution > Isolated` runs the same workspace file
   through `unshare` inside a WSL2 distro, in a fresh user, network, and PID
   namespace. The payload sees uid 0 but holds no host privilege, cannot reach
   the LAN or the internet, and cannot see or signal host processes. The option
   stays disabled unless a distro answers the probe and can create the
   namespaces.
4. **A desktop menu.** File / Run / View / Help forward stable command ids to
   the renderer, so the same shortcuts work from the menu and from the page.
5. **An integrated title row.** The window runs with a hidden title bar, so
   the renderer paints the whole title bar: the brand, the five application
   menus, the composed window title, and the header actions. Each menu opens
   the real native popup below its button in the active locale, and the
   caption buttons follow the light/dark theme. macOS keeps its traffic
   lights and system menu.
6. **A tray that owns the exit.** Closing the window hides it instead of
   ending the app, so a running job keeps going. The tray's left click
   restores and focuses the window, its right click opens a small settings
   menu (setup guide, API endpoint), and only its quit entry exits. The same
   menu carries `Check for updates…`, which asks GitHub for the latest stable
   release, reports the running and published versions, and opens the release
   page only when an update exists and its download button is chosen.
7. **A real interactive terminal.** The bottom panel gains a Terminal tab
   beside Output, Errors, Compile, and Diagnostics. It lists the installed
   shells (PowerShell, cmd, Git Bash, and WSL when present), starts sessions
   with xterm.js over a real PTY in the main process, and supports new
   sessions, switching, split panes, close, resize, and Ctrl+C. Hiding the
   panel, switching tabs, or visiting setup keeps the shell, its buffer, and
   its working directory alive; quitting the app disposes them.

The remote Sandkasten API stays available: switch `Execution` to `Sandbox API`
in the editor toolbar to submit the active file to the deployed service instead.

## Run

Build the web distribution first, then start the desktop app:

```sh
cd apps/web
npm ci
npm run build
cd ../desktop
npm install
npm start
```

The window loads `apps/web/dist/index.html` directly. API requests default to
same-origin paths; set `SANDKASTEN_API_BASE_URL` before launching to point at a
remote API. Because the committed `dist/` is shared with Pages and the server
installer, a configured origin is staged into one reusable scratch copy under
the Electron user-data directory (with a JSON-escaped `config.js`) instead of
rewriting the tracked bundle. There is no bundled secret: the desktop app never
reads or stores API tokens.

The last opened folder is remembered in `workspace.json` under the Electron
user-data directory. Set `SANDKASTEN_WORKSPACE_ROOT=/path/to/folder` to open a
folder without a dialog, which is how the end-to-end run and scripted checks
start the app.

If `apps/web/dist` is missing, the app shows an error dialog naming the
directory and exits instead of starting an empty window.

## Workspace and execution model

- Every renderer path is relative to the opened folder. The main process
  resolves it, rejects absolute paths, `..` segments, and NUL bytes, and refuses
  to touch anything outside the root.
- The explorer skips VCS and build directories (`.git`, `node_modules`, `dist`,
  `target`, `__pycache__`, …), caps the tree at 6 levels / 2000 entries, and
  refuses to open files above 2 MiB.
- Local runs execute the file **on disk**, so the app saves the active buffer
  before running. Compile steps (`rustc`, `gcc`, `g++`) build into a temporary
  directory that is removed after the run.
- Local execution is not sandboxed. It is opt-in per run through the backend
  selector and unavailable in the browser build.
- Isolated runs need WSL2 with a distro that ships `unshare` (`Ubuntu-22.04`,
  `Ubuntu`, and `Debian` are probed in that order; the first working one wins).
  Without one the backend reports itself unavailable instead of failing a run.
  The sandbox bounds what the payload can reach, not what it may read: the
  distro mounts the workspace through `/mnt/<drive>/…`, so workspace files stay
  reachable while host processes and the network do not.

## Security defaults

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- The preload is CommonJS (`src/preload.cjs`) because sandboxed preloads cannot
  be ES modules; `tests/preload.test.mjs` fails when the preload and the IPC
  registry drift apart.
- The preload exposes one `sandkastenDesktop` bridge: promise-based workspace
  file access, local and isolated run/detect/stop, and a menu-command
  subscription. The raw `ipcRenderer` never reaches the renderer.
- Navigations stay on `file:` URLs under the bundled distribution directory.
- External `http(s)` links are denied in the window and handed to the OS
  browser; `file:` paths outside the distribution and other schemes are
  rejected outright.
- `<webview>` attachment is disabled.
- Terminal access requires the trusted bundled top-level frame; the renderer
  picks discovered profile ids and never executable paths, requests are
  validated and bounded, and each session belongs to its creating window.

## Test and package

```sh
cd apps/desktop
npm test            # unit tests: workspace guard, local runner, IPC, menu, preload, tray, title row, terminal host, window policy
npm run smoke       # headless Electron launch against apps/web/dist
npm run e2e         # drives the real app: open folder, edit, save, run, screenshots
npm run e2e:refinement  # setup scrolling, welcome actions, and the real terminal
npm run package:dir # electron-builder unpacked output under tmp/desktop-dist
npm run package:win # NSIS installer (x64 + arm64) under tmp/desktop-dist
```

`npm run e2e` launches the app against a temporary workspace and asserts the
explorer tree, the local run output, `Ctrl+S` persistence, file creation, panel
toggling, the integrated title row with its native menu popup, close-to-tray,
the tray update entry, and both themes; it writes `tmp/desktop-ide-light.png` and
`tmp/desktop-ide-dark.png`. Set `SANDKASTEN_E2E_EXECUTABLE=tmp/desktop-dist/win-unpacked/Sandkasten.exe`
to run the same checks against a packaged build. It needs Python on `PATH` and
reuses the `playwright-core` already installed in `apps/web/node_modules`.

The tray update check is native, so the run cannot click it through the page.
The app publishes its live tray menu and answers the update dialog when
`SANDKASTEN_E2E_PROBE=1` is set, and the run reads the recorded rebuilds to
assert the progress label, the settled entry, and the reported versions. It
checks against a scripted `v9.9.9` release by default; set
`SANDKASTEN_E2E_RELEASE=<tag>` to pick another, `none` for a repository without
a stable release, or `live` to let the run reach the real GitHub API. The probe
is inert unless that variable is set, so a normal launch never exposes it.

`npm run e2e:refinement` additionally wheel-scrolls the setup guide at desktop
and compact sizes, drives the empty-editor welcome actions, and exercises a real
Command Prompt session: state and directory retention across panel and setup
changes, a split shell, an actual resize reaching the PTY, Ctrl+C on a running
program, session close, and the rejection of a closed session. The same command
runs against the packaged executable through `SANDKASTEN_E2E_EXECUTABLE`.

`package:dir` produces an unsigned unpacked build. The bundled WebUI is copied
into `resources/web-dist`, which the main process resolves through
`process.resourcesPath` when the app is packaged.

`node-pty` is the only desktop runtime dependency. Its shipped N-API prebuilds
for Windows x64 and arm64 are kept as-is (`npmRebuild` stays off on Windows)
and unpacked beside the asar together with `src/terminal-worker.mjs`, because a
native Worker cannot start from inside an archive.

## Windows installer

`npm run package:win` builds an assisted NSIS installer
(`Sandkasten-<version>-Setup.exe`) for x64 and arm64. It installs per user,
lets the user pick the destination directory, and creates desktop and Start Menu
shortcuts. The installer is unsigned, so Windows SmartScreen may warn on first
launch.

The payload is compressed with the classic BCJ filter. 7-Zip 24 selects the
newer ARM64 branch-converter filter for arm64 binaries when building on an
arm64 host, but the `nsis7z` plugin bundled with electron-builder predates that
filter and silently skips the affected entries, which produced installers
without `Sandkasten.exe`. The filter is pinned in
`electron-builder.config.mjs`; keep it pinned when touching the packaging
configuration.

Verify a built installer before publishing it:

```sh
npm run verify:installer                 # default: tmp/desktop-dist setup executable
node scripts/verify-installer.mjs <setup.exe>
```

The check lists every embedded payload with the same 7-Zip build that produced
it and fails when an entry uses a filter the plugin cannot decode or when the
executable, the asar bundle, or the bundled web distribution is missing.

## Release

Publish the verified installer as a GitHub release asset:

```sh
cd apps/desktop
npm run package:win
npm run verify:installer
GH_TOKEN=<token> npm run release:desktop
```

`release:desktop` re-verifies the payload, then creates (or reuses) the
`v<version>` release and uploads `Sandkasten-<version>-Setup.exe`. Pass
`--dry-run` to print the plan without touching GitHub, `--file <path>` to
upload a specific artifact, or `--notes-file <path>` for multiline release
notes (`--notes` takes short inline text). Re-running the command refreshes the
release title and notes instead of leaving stale metadata. `GH_TOKEN` (or
`GITHUB_TOKEN`) needs `repo` scope; the script never reads or stores any other
credential.
