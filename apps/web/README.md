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

Chrome geometry follows the measured VS Code workbench numbers: a 48 px
activity lane whose items are 48 px squares marked with a 2 px lane border on
the checked one and on keyboard focus, a 32 px editor tab lane whose active tab
paints the editor surface with a 1 px top accent, 35 px sidebar and panel title
rows, 22 px breadcrumbs, and a 22 px status strip. The panel keeps one 35 px
title row that carries the output tabs and the maximize/close actions and stays
pinned while the panel body scrolls. Colours stay Sandkasten's own so every
scheme and theme keeps working.
`docs/superpowers/specs/2026-09-23-vscode-ui-fidelity-design.md` records the
measurements, the per-region contract, and the remaining plan.

The status bar is one 22 px strip across the bottom of the shell, running under
the activity bar and the sidebar as well as the editor, the way the VS Code
status bar does. Its leading group names the execution target (the backend
badge), the connection — the API origin while the sandbox backend runs, the
session state otherwise — the workspace, the active file with its unsaved
marker, the errors and warnings of the last run, and icon actions for recent
runs, the terminal, the setup guide, and settings. Its trailing group reads the
open buffer: the run phase, the duration, the exit code, `Ln`/`Col`, the
detected indentation, `UTF-8`, the detected line ending, and the language mode
beside its file glyph. The problem counters and the run phase open the output
panel, and the secondary icon actions fold away below 1280 px so the readouts
always fit. Sandkasten has no language server, so the problem counters summarize
the last run: a failed request or run counts as one error, a run that hit a
resource limit and every `warning` line on stderr count as warnings.

The title row starts with the product mark alone, then the editor back and
forward arrows, then a centered search control that opens the command palette
(`Ctrl+P` for files, `Ctrl+Shift+P` for commands). The palette lists the real
commands with their accelerators, searches the workspace files, and shows
recently opened files before a query; the widget keeps the measured quick-input
geometry — 600 px wide, opened with a 250 ms fade and scale, 22 px rows with a
16 px icon column. The connection status, setup guide,
locale switcher, history, inspector, and theme buttons are gone from the title
row; their entry points live in the settings screen, the palette, and the
native menus.

The sidebar owns one header row: the view title on the left, the view actions
(new file, open folder, refresh, collapse folders) and the collapse control on the
right. Collapse folders folds every directory the tree is showing, the way VS
Code's explorer title action does. The
collapse button sits flush with the sidebar's top-right corner, hides the whole
sidebar, and matches `Ctrl+B`; selecting the active activity in the activity bar
collapses it too. Counts use VS Code's two badge shapes: a pill on the explorer
activity while any buffer is unsaved (with the count in its accessible name), and
a severity-tinted count badge on the panel's Diagnostics tab carrying the problems
of the last run.

Transient surfaces hand focus back when they close: Escape or a click outside the
editor's context menu returns to the editor, and closing the breadcrumb picker
returns to the step that opened it, rather than dropping focus on the document. Under the workspace tree the recent runs list sits behind a
VS Code pane header — a 22 px row whose chevron turns a quarter turn while the
section is collapsed, and whose trailing edge reveals a "clear run history"
action once there is a run to clear.

Files carry the real `vscode-icons` glyphs in the explorer, the tab strip, and
the breadcrumbs. The explorer's rows follow VS Code's two roles: hovering paints
the quiet list tint, while the open file gets the stronger selection fill, and a
nested row reveals one hairline indent guide per level. Scroll containers paint
VS Code's overlay slider — a transparent track with a translucent rounded slider
that strengthens on hover — while the tab rows keep their rail hidden, and the
standard `scrollbar-width`/`scrollbar-color` properties are deliberately left
unset on scrolling panes so that geometry survives in Chromium. `scripts/generate-file-icons.mjs` builds the extension, exact
file name, and folder name maps plus the inlined SVG table from the upstream
manifests at a pinned commit, and `src/editor/fileIcon.ts` resolves a path to
its icon id with a neutral default for unknown names. The distribution stays
four files because each reachable glyph ships inline in the bundle.

Under the tab strip, a breadcrumb trail names the open file's location: the
workspace root, then each folder, then the file with its glyph. A root or folder
step opens the VS Code picker — a dropdown under the step with an arrow, a filter
field that bolds the matching part, and the entries of that level — where a
folder reveals itself in the explorer (unfolding the tree when it was collapsed)
and a file opens. A tab reveals its close action on hover; while its
buffer is unsaved the same slot shows the filled dot VS Code uses, and the tab
names the unsaved state for assistive technology. The editor follows the VS Code
defaults: a 14 px monospace face on a 21 px line box, line numbers on the editor
surface in a five-character column, a quiet active-line fill with hairline rules,
one indentation guide per nesting level (with the step taken from the file's own
indentation, and blank lines carrying the guides of the block around them), the
bracket pair under the cursor boxed, the other occurrences of the selected
word highlighted, and the minimap rail at the right. The editor adds an optional
minimap that overviews the whole file and the current viewport; it is enabled in
the IDE shell only and hidden on the narrow layout.

## Settings screen

The settings button at the foot of the activity bar (and the compact floating
entry) opens a full-screen settings view framed like the VS Code settings
editor: a table-of-contents rail whose selected entry is bold, a header that
carries the section name and the search field over a rule, group titles at the
settings-editor size, and rows with the editor's padding and hover highlight. A
setting the user changed from its default — an overridden color, a non-default
color scheme — carries the two-pixel accent bar VS Code puts on a modified
setting. The sections are general, appearance, connection, and workbench.
Appearance offers system/light/dark theme previews and per-theme accent,
background, and foreground colors, all persisted and applied to the running
workbench. General holds the language choice, the setup guide, and the GitHub
link; workbench moves the API endpoint and color scheme controls, and links to
the history and inspector sheets. Escape and the back button both leave the
screen and return focus to the control that opened it.

The output panel carries its own maximize and close controls, so it can be
expanded or dismissed from the panel itself instead of only through the menu or
`Ctrl+J`. Hiding the panel clears the maximized state, so reopening it comes
back at its normal height. The window title reads
`<file> — <workspace> — <app>`, with a dot on the file while its buffer is
unsaved.

Feedback stays where the user is looking. A run raises a VS Code-style toast in
the bottom-right corner only when it finishes out of sight — the panel was closed
while the job kept polling — with the status as its message and the runtime and
duration underneath; the toast dismisses itself after a few seconds and its close
action appears on hover or keyboard focus. Everything else (the run bar, the
panel, the editor status line) reports inline.

The desktop shell is bounded to the viewport (`100dvh`), so the file tree, the
editor, and the output panel scroll inside their own panes with the mouse wheel
while the status bar and the activity bar stay pinned. The document itself does
not grow with the workspace or the output, so a large tree or a noisy program
never pushes the panel or the status bar out of reach.

The title row shows the product mark alone, without the wordmark beside it.
Both the mark and the favicon are inlined as data URIs, so the shipped
distribution stays exactly four files (`app.js`, `config.js`, `index.html`,
`styles.css`).

The workspace holds one or more open files. With no file open the editor shows
the welcome page in the shape of VS Code's Get Started tab: the product name and
its one-line description over a two-column grid, a **Start** column (new file,
open folder, quick open) with the **Recent** files from the editor history under
it, a **Next steps** column (setup guide, settings), and a centred shortcut hint
in the footer. In the browser the workspace is an
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
editor, `Ctrl+,` open settings, `Ctrl+O` open a folder (desktop), `Ctrl+B` toggle
sidebar, `Ctrl+J` toggle the output panel, `Ctrl+P`
open a file from the palette, `Ctrl+Shift+P` run a command from it, and `Ctrl+F`
open the editor's find widget — a floating VS Code-style widget with the match
counter, the `Aa` / `ab` / `.*` switches, and an expandable replace row.
Every shortcut the palette prints is bound, and the actions that live on the view
title rows (refresh files, collapse folders, clear the run history, delete the
active file, maximize the panel) are palette commands as well, so nothing is
reachable from only one place.
Right-clicking the editor opens the workbench's own context menu (Cut, Copy,
Paste, Select All, Undo, Redo, Find with their accelerators) instead of the
browser menu; it keeps a selection you right-click inside, greys out the
commands that cannot run, and reports a refused clipboard action above the
editor's bottom edge. `Shift+F10` (or the keyboard's menu key) opens the same
menu at the caret, and either way the menu clamps itself into the window.

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
