# Vue WebUI Redesign Design

**Date:** 2026-08-20
**Status:** Approved direction, implementation pending

## 1. Purpose

Replace the dependency-free Sandkasten WebUI with a Vue 3 application and
redesign it as a focused code-running workbench. The first screen remains the
actual runner: users can select a runtime, edit source, submit a job, monitor
its state, and inspect every output channel without navigating through a
marketing site.

The visual direction combines two local references:

- `prompt/prompt/dieWehmut.github.io`: dense Vue component structure, fixed
  workspace navigation, restrained borders, monochrome surfaces, subtle grid
  texture, and reduced-motion support.
- `prompt/prompt/Glimmer`: warm surfaces, rose accent, clear state chips,
  lightweight glow, and a three-column operational workspace.

Sandkasten must not inherit Glimmer's fairy-tale narrative, oversized landing
hero, chat metaphor, or decoration-heavy particle effects. It is an operations
tool, so the interface stays quiet, compact, and optimized for repeated runs.

## 2. Product Scope

### 2.1 Included

- Vue 3, TypeScript, and Vite application under `webui/`.
- A desktop three-pane workbench and responsive tablet/mobile layouts.
- A CodeMirror-based source editor with line numbers, common editing keymaps,
  bracket matching, search, and a plain-text fallback language mode.
- Runtime loading, asynchronous job submission, polling, stopping and resuming
  polling, result rendering, and retryable connection errors.
- In-memory recent-run history for the current page session.
- Complete output inspection for stdout, stderr, compile stdout, compile
  stderr, diagnostics, truncation, encoding, duration, exit code, and signal.
- System-aware light/dark themes with a persisted user preference.
- A deterministic prebuilt distribution for GitHub Pages and the installer.
- Unit, component, build-contract, installer, and browser-level tests.

### 2.2 Excluded

- Marketing, About, Guide, Login, or other multi-page routes.
- Server-side job cancellation. The backend does not expose a cancellation
  endpoint; the UI action remains **Stop polling**.
- API credentials in Pages configuration or browser storage.
- Server-persisted run history, accounts, collaboration, or source sharing.
- Monaco, a custom syntax highlighter, particle canvases, animated cursors, or
  decorative full-screen effects.

## 3. Information Architecture

The application uses a single full-height workbench rather than stacked page
cards.

### 3.1 Global Header

The 52px header contains:

- Sandkasten wordmark and a compact cube/terminal mark.
- API connection state: `Connected`, `Connecting`, or `Unavailable`.
- Icon buttons for history visibility, inspector visibility, theme, and the
  GitHub repository. Each unfamiliar icon has a tooltip and accessible label.

The brand is visible in the first viewport but does not compete with the
editor. There is no hero headline or explanatory onboarding copy.

### 3.2 Desktop Layout

At widths of 1200px and above:

```text
+------------------+--------------------------------------+--------------------+
| Recent runs      | Source workbench                     | Inspector          |
| 232-256px        | minmax(0, 1fr), minimum 560px        | 288-320px          |
|                  |                                      |                    |
| status + runtime | runtime selector + run toolbar       | runtime metadata   |
| time + duration  | CodeMirror editor                    | job metadata       |
|                  | status timeline                      | limits / encoding  |
|                  | output tabs                          | diagnostics summary|
+------------------+--------------------------------------+--------------------+
```

The panes are separated by one-pixel rules. They are not floating cards and do
not contain nested card layouts. The history and inspector panes may be hidden
independently; the editor expands without layout jumps.

### 3.3 Tablet Layout

From 768px through 1199px, the editor and output remain in the primary flow.
History and inspector open as edge sheets controlled by header icon buttons.
The toolbar retains stable heights and wraps only its text-bearing controls.

### 3.4 Mobile Layout

Below 768px:

- The header remains a single non-overlapping row.
- Runtime selection and Run action form a compact toolbar above the editor.
- The editor uses a stable height between 18rem and 52vh.
- Job status and output tabs follow the editor in normal document flow.
- History and inspector use full-height modal sheets.
- Run/Stop actions remain reachable without covering source or output.
- Long runtime names, job IDs, and output lines wrap or scroll within their own
  regions and never widen the viewport.

## 4. Visual System

### 4.1 Principles

- Professional code tool, not a landing page.
- Warm neutral surfaces, true semantic status colors, and one rose accent.
- Square operational geometry with 4px to 8px radii.
- No gradient background, bokeh, decorative orb, or card-in-card composition.
- Motion communicates state and spatial changes; it is never ambient noise.

### 4.2 Core Tokens

Light theme:

```css
--canvas: #f7f6f3;
--surface: #ffffff;
--surface-subtle: #f1efec;
--text: #211d1e;
--text-muted: #746b6d;
--border: #d9d3d4;
--border-strong: #b9afb1;
--accent: #d95f8d;
--accent-strong: #ad3767;
--success: #21865d;
--warning: #a86312;
--danger: #bd3c48;
--info: #3d70a8;
```

Dark theme:

```css
--canvas: #161315;
--surface: #1d191c;
--surface-subtle: #262125;
--text: #f4eff1;
--text-muted: #b7aeb1;
--border: #3a3337;
--border-strong: #554a50;
--accent: #f08ab0;
--accent-strong: #ffadca;
--success: #62c897;
--warning: #e4aa5c;
--danger: #f17b84;
--info: #79a9dd;
```

The canvas may use a subtle 28px grid made from one-pixel lines at no more than
4% opacity. Accent tint may appear in focused controls and the active run only;
it must not dominate all surfaces.

### 4.3 Typography

- UI: `Inter`, system UI fallback.
- Source/output: `JetBrains Mono`, `SFMono-Regular`, Consolas, monospace.
- Wordmark: the UI font at 700 weight; no script display font.
- 14px base operational text, 12px metadata, 16-18px pane headings.
- Letter spacing is zero except small uppercase metadata labels, which may use
  `0.04em`.

### 4.4 Interaction and Motion

- Hover/focus transitions: 150ms to 200ms.
- Pane/sheet transitions: 220ms.
- Active polling uses a local status-dot pulse only.
- A new output block may fade and translate upward by at most 4px.
- `prefers-reduced-motion: reduce` disables translation, pulsing, and smooth
  scrolling while retaining immediate state changes.

## 5. Component Architecture

```text
App
|- AppHeader
|  |- ConnectionStatus
|  `- HeaderActions
|- WorkbenchShell
|  |- RunHistory
|  |  `- RunHistoryItem
|  |- SourceWorkbench
|  |  |- WorkbenchToolbar
|  |  |  |- RuntimeSelect
|  |  |  `- RunControls
|  |  |- SourceEditor
|  |  |- JobTimeline
|  |  `- OutputTabs
|  |     `- OutputViewer
|  `- InspectorPanel
|     |- RuntimeInspector
|     |- JobInspector
|     `- DiagnosticSummary
|- EdgeSheet (tablet/mobile history)
`- EdgeSheet (tablet/mobile inspector)
```

Each component has one responsibility. Network access and state transitions do
not live in view components.

### 5.1 Source Editor

`SourceEditor.vue` wraps CodeMirror 6. It accepts `modelValue`, the selected
runtime language, disabled state, and an accessible label. It emits source
changes without knowing about jobs or the API. Runtime-to-language-extension
mapping lives in a separate module and falls back to plain text for unknown
runtimes.

### 5.2 Output Tabs

The output area has four stable tabs:

1. **Output**: decoded stdout.
2. **Errors**: decoded stderr.
3. **Compile**: compile stdout and compile stderr as separate labeled streams.
4. **Diagnostics**: error message and structured diagnostics rendered as text.

Tabs display a small indicator when their channel contains content. Every
viewer provides a copy icon, empty state, encoding label, and truncation badge.
No server-controlled content is rendered with `v-html`.

### 5.3 Run History

History is an in-memory list scoped to the current page session. Each entry
stores source, selected language, job response, timestamps, and the latest
result. The maximum is 20 entries. Selecting an entry restores its source and
result into the workbench without contacting the server. Reloading the page
clears history, avoiding unexpected persistent storage of user source code.

## 6. State and Data Flow

### 6.1 API Layer

`src/services/sandkastenApi.ts` exports pure functions:

```ts
resolveApiUrl(pathname, config?)
loadRuntimes(fetchImpl?)
submitJob(language, source, fetchImpl?, signal?)
getJob(jobId, fetchImpl?, signal?)
pollJob(jobId, options?)
```

The external `config.js` remains loaded before the Vue bundle and defines only:

```js
globalThis.SANDKASTEN_CONFIG = { apiBaseUrl: "" };
```

Empty `apiBaseUrl` means same-origin. Joining trims trailing base slashes and
normalizes a single leading API-path slash. Requests send `Accept:
application/json`; submissions additionally send `Content-Type:
application/json` with `{ source, wait: false }`.

### 6.2 Runner State Machine

`useRunner()` owns these states:

```text
booting -> ready
booting -> unavailable -> booting (retry)
ready -> submitting -> polling -> completed
submitting -> error -> ready
polling -> stopped -> polling (resume)
polling -> completed
polling -> error -> ready
```

Only one current run may poll at a time. Every submission receives a monotonically
increasing generation number. Async completions update UI only when their
generation remains current, preventing an old request's `finally` block from
overwriting a newer run.

**Stop polling** aborts only the browser request/timer and changes the message to
`Monitoring stopped. The job may still be running.` If a job ID exists, **Resume
polling** starts GET polling again. The UI never claims that the backend job was
canceled.

### 6.3 Terminal Status Contract

Polling stops for exactly these API status strings:

- `JOB_STATUS_SUCCEEDED`
- `JOB_STATUS_COMPILE_FAILED`
- `JOB_STATUS_RUNTIME_FAILED`
- `JOB_STATUS_TIME_LIMIT_EXCEEDED`
- `JOB_STATUS_MEMORY_LIMIT_EXCEEDED`
- `JOB_STATUS_OUTPUT_LIMIT_EXCEEDED`
- `JOB_STATUS_CANCELED`
- `JOB_STATUS_SYSTEM_ERROR`

Unknown non-empty statuses remain pollable. Missing/invalid statuses fail with a
visible protocol error.

### 6.4 Output Decoding

The UI respects `stdoutEncoding`, `stderrEncoding`, `compileStdoutEncoding`, and
`compileStderrEncoding`:

- Missing or `utf8`: render the field directly.
- `base64`: decode bytes with `atob`, then decode UTF-8 with `TextDecoder`.
- Invalid or unsupported encoding: retain the original string, mark the channel
  as undecodable, and show a non-destructive warning.

Decoded and raw values are always assigned as text nodes.

## 7. Errors, Empty States, and Accessibility

- Runtime-load failure leaves the editor usable but disables Run and shows a
  compact retry panel with the actual error message.
- Submission/polling errors appear in the timeline and Diagnostics tab without
  clearing previous output.
- HTTP errors prefer the server's human-readable `message`, then `error`, then
  status text.
- Status changes use `aria-live="polite"`; request failures use `role="alert"`.
- All controls are keyboard reachable with visible focus rings.
- Tabs implement tab/tabpanel roles and arrow-key navigation.
- Sheets trap focus while open, close with Escape, and restore focus to their
  trigger.
- Semantic status is never conveyed by color alone; icon and label accompany it.
- The editor and output regions have stable dimensions to prevent job updates
  from shifting the surrounding layout.

## 8. Build and Deployment

### 8.1 Source and Distribution

`webui/` becomes a conventional Vite project:

```text
webui/
|- package.json
|- package-lock.json
|- tsconfig.json
|- vite.config.ts
|- index.html
|- public/config.js
|- src/**
|- tests/**
`- dist/
   |- index.html
   |- app.js
   |- styles.css
   `- config.js
```

Vite uses `base: "./"`, disables source maps, disables CSS splitting, and
configures fixed root-level filenames. The application has no image/font assets
that would create a hashed `assets/` directory. The committed `dist/` is the
installer payload and is regenerated for every WebUI change.

### 8.2 GitHub Pages

The Pages workflow:

1. Sets up the pinned Node major version.
2. Runs `npm ci` in `webui/`.
3. Runs unit/component tests.
4. Runs `npm run build`.
5. Copies `webui/dist/` to `_site/`.
6. Replaces `_site/config.js` with JSON-escaped
   `vars.SANDKASTEN_API_BASE_URL`.
7. Runs the artifact contract test.
8. Uploads and deploys `_site/`.

The deployed artifact remains exactly four regular files, with no source tree,
lockfile, test, source map, symlink, or nested directory.

### 8.3 Self-Hosted Installer

The installer validates and atomically copies `webui/dist/`, not the whole
source project. Installation still requires neither Node nor package download.
The existing ownership marker, Nginx static fallback, `/v1/` proxy, `/healthz`
proxy, and marker-gated cleanup behavior remain unchanged.

The repository must reject stale committed distributions by rebuilding in a
temporary directory and comparing the expected four files with `webui/dist/`.

## 9. Testing Strategy

### 9.1 Unit Tests

Use Vitest for:

- API URL joining and same-origin default.
- Runtime response validation.
- Submission request method, URL, headers, and body.
- All eight terminal statuses and unknown-status polling.
- abort/resume behavior and stale-generation protection.
- HTTP/protocol error messages.
- UTF-8/base64 output decoding and invalid-encoding fallback.
- history limit and selection behavior.
- theme preference and reduced-motion helpers.

### 9.2 Component Tests

Use Vue Test Utils with a DOM test environment for:

- runtime loading, retry, and disabled Run states.
- source editing and submission.
- accurate Stop/Resume polling labels.
- status timeline and live regions.
- output tab keyboard behavior, copy actions, truncation, and encoding badges.
- history selection.
- inspector metadata.
- responsive sheet triggers and Escape behavior.
- absence of `v-html` for API-controlled output.

### 9.3 Contract and Integration Tests

- Update `scripts/pages-artifact-test.sh` for the Vite build workflow and exact
  four-file output.
- Update installer tests to require and copy `webui/dist/` only.
- Add a distribution freshness check.
- Include WebUI tests/build in the repository quality test entrypoint.
- Keep backend HTTP tests as the source of truth for JSON field names.

### 9.4 Browser Acceptance

Run the built application through a local static server and inspect it with
Playwright at minimum:

- Desktop: 1440x900.
- Tablet: 1024x768.
- Mobile: 390x844.
- Light and dark themes.
- Runtime-load success and failure.
- queued, polling, stopped, succeeded, compile failure, runtime failure, and
  resource-limit results.

Screenshots must show a nonblank editor, no overlapping controls, no horizontal
page overflow, readable longest labels, stable pane dimensions, and reachable
history/inspector on mobile. Canvas-pixel checks are unnecessary because the
design contains no canvas.

## 10. Documentation

Update the WebUI README, root README, deployment guide, architecture guide, and
installer design notes to describe:

- Vue/Vite development and test commands.
- committed distribution and freshness requirement.
- Pages build/deploy flow.
- installer deployment from `webui/dist`.
- API base, HTTPS, CORS, and prohibition on browser-embedded API secrets.
- Stop polling semantics and the lack of server cancellation.

## 11. Delivery Sequence

Implementation is split into reviewable commits:

1. Vue/Vite toolchain, typed API layer, and tests.
2. Runner state machine, output decoding, and tests.
3. Workbench components and CodeMirror editor.
4. Visual system, responsive sheets, themes, and accessibility.
5. Fixed distribution, Pages workflow, and artifact checks.
6. Installer integration, distribution freshness, and documentation.
7. Browser screenshots, final audit fixes, and deployment verification.

Each commit must keep its focused tests green. The final branch is complete only
after local tests, deterministic build checks, installer tests, Playwright
screenshots, GitHub Actions, and the live `/Sandkasten/` Pages deployment all
verify the Vue workbench.
