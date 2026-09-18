# Sandkasten WebUI

The WebUI is a Vue 3 and TypeScript workbench built with Vite. It loads
`GET /v1/runtimes`, submits source with `POST /v1/{language}/run`, and polls
`GET /v1/jobs/{jobId}`. API-controlled source, errors, and output are rendered
as text; components do not inject them as HTML.

## Workbench layout

Above 1200 px the workbench renders an editor-first layout: an activity bar
(explorer, recent runs, inspector, setup guide), a sidebar with the workspace
file tree and recent runs, open-file tabs, a CodeMirror editor, a bottom output
panel, and a status bar. Narrower windows fall back to the single-column
layout with history and inspector sheets.

The sidebar owns one header row: the view title on the left, the view actions
(new file, open folder, refresh) and the collapse control on the right. The
collapse button sits flush with the sidebar's top-right corner, hides the whole
sidebar, and matches `Ctrl+B`; selecting the active activity in the activity bar
collapses it too.

Files carry a language mark in the explorer and the tab strip: one silhouette
per file kind and one hue per language family, resolved from the same table in
`src/editor/fileIcon.ts`. The tones are declared per theme because a hue that
reads on the light surface disappears on the dark one; every value is checked at
4.5:1 against the surfaces it renders on.

Under the tab strip, a breadcrumb trail names the open file's location: the
workspace root, then each folder, then the file with its language mark. Folder
steps are buttons that reveal themselves in the explorer, unfolding the tree
when the folder was collapsed. The editor adds an optional minimap that
overviews the whole file and the current viewport; it is enabled in the IDE
shell only and hidden on the narrow layout.

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

The header shows the product mark next to the name. Both the header icon and
the favicon are inlined as data URIs, so the shipped distribution stays
exactly four files (`app.js`, `config.js`, `index.html`, `styles.css`).

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
editor, `Ctrl+B` toggle sidebar, `Ctrl+J` toggle the output panel.

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

- `data-theme`: `light` or `dark`, persisted as `sandkasten-theme`.
- `data-color-scheme`: `green`, `purple`, `pink`, `white`, or `black`,
  persisted as `sandkasten-color-scheme`.

`green` is the historical default and stays the deterministic first-visit
accent: an untouched install renders green in both themes, and nothing is
persisted until the user picks a scheme. The monochrome `white` and `black`
schemes stay opt-in: `white` is a deep gray in the light theme and pure white in
the dark theme, so it reads as the strongest available contrast in either
theme. Only an explicit pick is written to `localStorage`.

The accent tokens live in `src/styles/schemes.css`; `tokens.css` keeps the
neutral surfaces, text, borders, and semantic states. Every scheme overrides
the same three tokens (`--accent`, `--accent-strong`, `--accent-soft`) in both
themes, and a final `color-mix()` block derives `--selection` and
`--focus-ring` from the active accent, so components never learn which scheme
is active. The catalog lives in `src/theme/colorScheme.ts`;
`src/composables/useColorScheme.ts` restores storage, applies the document
attribute, and persists explicit choices.

The header palette button opens a menu with one swatch per scheme. The choice
persists across reloads, and `apps/web/tests/colorScheme.test.ts`,
`apps/web/tests/styles.test.ts`, and the browser smoke cover the catalog,
contrast, persistence, and switch behavior.

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
