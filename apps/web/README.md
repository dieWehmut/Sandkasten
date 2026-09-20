# Sandkasten WebUI

The WebUI is a Vue 3 and TypeScript workbench built with Vite. It loads
`GET /v1/runtimes`, submits source with `POST /v1/{language}/run`, and polls
`GET /v1/jobs/{jobId}`. API-controlled source, errors, and output are rendered
as text; components do not inject them as HTML.

## Workbench layout

Above 1200 px the workbench renders an editor-first layout: an activity bar
(explorer, recent runs, inspector, settings), a sidebar with the workspace
file tree and recent runs, open-file tabs, a CodeMirror editor, a bottom output
panel, and a status bar. Narrower windows fall back to the single-column
layout with history and inspector sheets, and open settings from the floating
entry at the bottom-right, since they have no activity bar.

The title row starts with the product mark alone, then the editor back and
forward arrows, then a centered search control that opens the command palette
(`Ctrl+P` for files, `Ctrl+Shift+P` for commands). The palette lists the real
commands with their accelerators, searches the workspace files, and shows
recently opened files before a query. The connection status, setup guide,
locale switcher, history, inspector, and theme buttons are gone from the title
row; their entry points live in the settings screen, the palette, and the
native menus.

The sidebar owns one header row: the view title on the left, the view actions
(new file, open folder, refresh) and the collapse control on the right. The
collapse button sits flush with the sidebar's top-right corner, hides the whole
sidebar, and matches `Ctrl+B`; selecting the active activity in the activity bar
collapses it too.

Files carry the real `vscode-icons` glyphs in the explorer, the tab strip, and
the breadcrumbs. `scripts/generate-file-icons.mjs` builds the extension, exact
file name, and folder name maps plus the inlined SVG table from the upstream
manifests at a pinned commit, and `src/editor/fileIcon.ts` resolves a path to
its icon id with a neutral default for unknown names. The distribution stays
four files because each reachable glyph ships inline in the bundle.

Under the tab strip, a breadcrumb trail names the open file's location: the
workspace root, then each folder, then the file with its glyph. Folder
steps are buttons that reveal themselves in the explorer, unfolding the tree
when the folder was collapsed. The editor adds an optional minimap that
overviews the whole file and the current viewport; it is enabled in the IDE
shell only and hidden on the narrow layout.

## Settings screen

The settings button at the foot of the activity bar (and the compact floating
entry) opens a full-screen settings view modelled on the Codex reference: a
section sidebar with a search box, and sections for general,
appearance, and workbench. Appearance offers system/light/dark theme previews
and per-theme accent, background, and foreground colors, all persisted and
applied to the running workbench. General holds the language choice, the setup
guide, and the GitHub link; workbench moves the API endpoint and color scheme
controls, and links to the history and inspector sheets. Escape and the back
button both leave the screen and return focus to the control that opened it.

The output panel carries its own maximize and close controls, so it can be
expanded or dismissed from the panel itself instead of only through the menu or
`Ctrl+J`. Hiding the panel clears the maximized state, so reopening it comes
back at its normal height. The window title reads
`<file> — <workspace> — <app>`, with a dot on the file while its buffer is
unsaved.

The desktop shell is bounded to the viewport (`100dvh`), so the file tree, the
editor, and the output panel scroll inside their own panes with the mouse wheel
while the status bar and the activity bar stay pinned. The document itself does
not grow with the workspace or the output, so a large tree or a noisy program
never pushes the panel or the status bar out of reach.

The title row shows the product mark alone, without the wordmark beside it.
Both the mark and the favicon are inlined as data URIs, so the shipped
distribution stays exactly four files (`app.js`, `config.js`, `index.html`,
`styles.css`).

The workspace holds one or more open files. In the browser the workspace is an
in-memory scratch workspace persisted under `sandkasten-workspace-v1`; in the
desktop app the same UI reads and writes a real folder through the preload
bridge described below. Files are never sent anywhere except the execution
backend the user selected, and `Ctrl+S` writes the active buffer.

Three execution backends share one output surface:

- **Sandboxed API** (`Sandbox API`): the remote Sandkasten service, unchanged
  from the browser contract above.
- **Local** (`Local`): the desktop app runs the active file with the toolchains
  installed on the machine through `window.sandkastenDesktop.runner`. This
  backend is unsandboxed, unavailable in the browser, and offered only when the
  file's runtime is installed.
- **Isolated** (`Isolated`): the desktop app runs the same file through
  `window.sandkastenDesktop.isolated`, which executes it inside a WSL2 user,
  network, and PID namespace. Offered only when a distro can create those
  namespaces; the status bar labels the run `Isolated run`.

Keyboard: `Ctrl+S` save, `Ctrl+Enter` run, `Ctrl+N` new file, `Ctrl+W` close
editor, `Ctrl+B` toggle sidebar, `Ctrl+J` toggle the output panel, `Ctrl+P`
open a file from the palette, and `Ctrl+Shift+P` run a command from it.

### Desktop bridge contract

`apps/desktop` injects `window.sandkastenDesktop` from its sandboxed preload
script. The bundle treats the bridge as optional and degrades to the scratch
workspace, so the same `apps/web/dist` payload serves GitHub Pages and the
desktop app:

```ts
window.sandkastenDesktop = {
  platform, versions,
  workspace: { openFolder, root, list, read, write, create, remove },
  runner: { detect, run, stop },
  isolated: { detect, run, stop },
  onMenuCommand(handler),
};
```

Every path passed to `workspace.*` is relative to the opened folder; the main
process rejects anything that escapes it. `runner.run({ jobId, path, language })`
resolves to a job-shaped result (`status`, `stdout`, `stderr`, `exitCode`,
`durationMs`) so the panel, tabs, and status bar need no backend-specific code.

## Develop and test

Use the Node.js release pinned by the Pages workflow (Node 22.18.0):

```sh
cd apps/web
npm ci
npm run dev -- --host 127.0.0.1
```

The Vite development server expects the Sandkasten API at the same origin, or
behind a local reverse proxy that exposes `/v1/` and `/healthz`. Run the unit
and component suite with:

```sh
cd apps/web
npm test
```

Run the real-browser responsive smoke against the committed distribution with
the local mock API:

```sh
cd apps/web
npm run build
npm run test:browser
```

The smoke reuses an installed Chrome or Edge executable and never downloads a
browser. It checks the desktop (1440x900), tablet (1024x768), and mobile
(390x844) layouts, including overflow, compact panels, theme switching, run
success, resume polling, color scheme switching, and output/error text
rendering. Screenshots are
written to the ignored `tmp/webui-browser-smoke/` directory. Set
`SANDKASTEN_BROWSER_PATH` to override executable discovery when needed.

## Themes and color schemes

The workbench keeps two independent appearance axes: a light/dark surface
theme and a five-color accent scheme. Both reach the document as attributes on
`<html>` before the workbench renders, so the first paint already uses the
active pairing:

- `data-theme`: `light` or `dark`, persisted as `sandkasten-theme`. The
  settings screen also offers `system`, which follows the OS preference and
  updates while the app runs.
- `data-color-scheme`: `green`, `purple`, `pink`, `white`, or `black`,
  persisted as `sandkasten-color-scheme`.

`pink` is the deterministic first-visit accent and matches the neutral shell
the reference uses: an untouched install renders pink in both themes, and
nothing is persisted until the user picks a scheme. A previously saved choice
still wins. The monochrome `white` and `black` schemes stay opt-in: `white` is
a deep gray in the light theme and pure white in the dark theme, so it reads as
the strongest available contrast in either theme. Only an explicit pick is
written to `localStorage`.

The accent tokens live in `src/styles/schemes.css`; `tokens.css` keeps the
neutral surfaces, text, borders, and semantic states. Every scheme overrides
the same accent family (`--accent`, `--accent-strong`, `--accent-soft`,
`--accent-fill`, `--on-accent`) in both themes, and a final `color-mix()`
block derives `--selection` and `--focus-ring` from the active accent, so
components never learn which scheme is active. Filled buttons and badges paint
`--accent-fill` and put `--on-accent` on top, which lets a soft reference hue
carry small labels without weakening contrast. The catalog lives in
`src/theme/colorScheme.ts`; `src/composables/useColorScheme.ts` restores
storage, applies the document attribute, and persists explicit choices.

The neutral surfaces keep a soft, low-contrast feel instead of hard separators:
`--chrome` paints the activity bar, the sidebar, and the status row, the editor
sits on a raised rounded surface, and selection states use a quiet
`--surface-subtle` fill rather than an accent rail. `--radius-sm`,
`--radius-md`, and `--radius-lg` scale the rounded corners across the shell.

The settings screen holds the scheme selector, alongside the theme previews and
the per-theme accent, background, and foreground colors. The choice persists
across reloads, and `apps/web/tests/colorScheme.test.ts`,
`apps/web/tests/appearance.test.ts`, `apps/web/tests/styles.test.ts`, and the
browser smoke cover the catalog, contrast, persistence, and switch behavior.

## Production distribution

Create the production payload with:

```sh
cd apps/web
npm run build
```

Vite writes exactly four regular files to `apps/web/dist`:

- `index.html`
- `app.js`
- `styles.css`
- `config.js`

There are no nested assets, source maps, tests, lockfiles, or symbolic links.
The HTML uses relative `./` references and loads `config.js` before `app.js`, so
the same payload works at the GitHub Pages project path `/Sandkasten/` and at an
installer-managed site root. The four files are committed because the server
installer copies this prebuilt payload and never installs Node.js packages.

The source runtime config deliberately keeps its nullish, same-origin default:

```js
globalThis.SANDKASTEN_CONFIG ??= { apiBaseUrl: '' };
```

Validate a clean deterministic build and the committed payload with:

```sh
cd apps/web
node --test tests/build-contract.test.mjs
cd ..
bash scripts/webui-build-test.sh --test
```

To preview the built distribution without extra tooling, use the bundled
dependency-free server (defaults to `127.0.0.1:4173`):

```sh
cd apps/web
npm run serve
```

`npm run serve` serves only the four distribution files, rejects path
traversal, and disables caching. It accepts `--port`, `--host`, and
`--directory` when run as `node scripts/serve.mjs`. A plain static server
works too, for example `python3 -m http.server 8080 --directory apps/web/dist`.

Execution still needs a same-origin API or reverse proxy unless the staged
`config.js` provides a separate public API base URL.

## GitHub Pages

The public site is <https://diewehmut.github.io/Sandkasten/>. On every push to
`main`, `.github/workflows/pages.yml` installs from `package-lock.json`, runs
the unit tests, builds and validates the four-file distribution, stages it,
and deploys it with the official GitHub Pages actions. The workflow can also be
started manually with `workflow_dispatch`; select **GitHub Actions** as the
Pages source under **Settings > Pages**.

The staged Pages artifact replaces only its copy of `config.js` with a
JSON-escaped direct assignment such as:

```js
globalThis.SANDKASTEN_CONFIG = { apiBaseUrl: "https://runner.example.com" };
```

Set the repository variable `SANDKASTEN_API_BASE_URL` under **Settings >
Secrets and variables > Actions > Variables** to a public HTTPS API origin, or
to an origin plus path prefix. An unset value remains empty and therefore uses
same-origin requests. This value is public: never put tokens, passwords, or
other secrets in it.

When Pages and the API use different origins, the API must allow
`https://diewehmut.github.io` through CORS. The CORS value is the origin only;
do not append `/Sandkasten/`.

Validate the workflow and a representative staged artifact with:

```sh
bash scripts/pages-artifact-test.sh --test
```
