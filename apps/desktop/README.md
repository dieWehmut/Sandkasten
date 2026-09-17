# Sandkasten Desktop

An Electron shell that loads the built `apps/web` distribution from disk and
talks to the Sandkasten HTTP API. It is a desktop wrapper around the same
workbench published to GitHub Pages, so the UI, API contract, and
`config.js` runtime configuration are identical.

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

If `apps/web/dist` is missing, the app shows an error dialog naming the
directory and exits instead of starting an empty window.

## Security defaults

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- The preload exposes only `platform` and Electron/Chromium versions.
- Navigations stay on `file:` URLs under the bundled distribution directory.
- External `http(s)` links are denied in the window and handed to the OS
  browser; `file:` paths outside the distribution and other schemes are
  rejected outright.
- `<webview>` attachment is disabled.

## Test and package

```sh
cd apps/desktop
npm test            # unit tests: window options, navigation policy, distribution resolution
npm run smoke       # headless Electron launch against apps/web/dist
npm run package:dir # electron-builder unpacked output under tmp/desktop-dist
npm run package:win # NSIS installer (x64 + arm64) under tmp/desktop-dist
```

`package:dir` produces an unsigned unpacked build. The bundled WebUI is copied
into `resources/web-dist`, which the main process resolves through
`process.resourcesPath` when the app is packaged.

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
