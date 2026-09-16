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
same-origin paths; set `SANDKASTEN_API_BASE_URL` before launching (or edit the
built `config.js`) to point at a remote API. There is no bundled secret: the
desktop app never reads or stores API tokens.

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
```

`package:dir` produces an unsigned unpacked build. The bundled WebUI is copied
into `resources/web-dist`, which the main process resolves through
`process.resourcesPath` when the app is packaged.
