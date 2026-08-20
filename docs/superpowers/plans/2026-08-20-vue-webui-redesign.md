# Vue WebUI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax for tracking.

**Goal:** Replace the static Sandkasten runner with a tested Vue 3/Vite workbench that preserves the API contract while delivering a restrained three-pane responsive UI inspired by the local dieWehmut and Glimmer references.

**Architecture:** Vue source lives in webui/src; Vite emits a fixed four-file boundary in webui/dist; Pages builds that boundary in CI; the installer copies only the prebuilt files. A typed API service owns HTTP details, useRunner owns task state, and view components only render state and emit intent.

**Tech Stack:** Vue 3, TypeScript, Vite, CodeMirror 6, Lucide Vue icons, Vitest, Vue Test Utils, jsdom, Playwright, GitHub Pages Actions, existing Bash installer tests.

---

## Task 1: Vue/Vite Foundation and API Contract

**Files:**
- Create: webui/package.json, webui/package-lock.json, webui/tsconfig.json, webui/vite.config.ts
- Create: webui/src/env.d.ts, webui/public/config.js, webui/src/services/sandkastenApi.ts
- Create: webui/tests/sandkastenApi.test.ts
- Modify: webui/index.html

- [ ] Write red tests for URL joining, runtime validation, request method/headers/body, HTTP message preference, all eight terminal statuses, unknown statuses, and UTF-8/base64 output decoding. Run "cd webui && npm test"; it must fail before the package exists.
- [ ] Add a pinned package manifest with dev, build, test, and test:watch scripts. Use Vue/Vite/TypeScript, CodeMirror, Lucide, Vitest, Vue Test Utils, and jsdom. Run npm install in webui to create the lockfile; never commit node_modules.
- [ ] Implement typed Runtime and JobResponse adapters matching the actual backend: runtime fields retain snake_case names such as default_entrypoint, while job fields retain jobId, compileStderr, errorMessage, and the four *Encoding fields. Do not invent a runtime.label contract.
- [ ] Export resolveApiUrl, loadRuntimes, submitJob, getJob, pollJob, and decodeOutput. Preserve empty-base same-origin behavior, Accept: application/json, POST body { source, wait: false }, and server message over error precedence.
- [ ] Keep webui/public/config.js before the Vue module in index.html. Its only statement is:

    globalThis.SANDKASTEN_CONFIG ??= { apiBaseUrl: '' };

- [ ] Configure Vite with base ./, no source maps, no CSS splitting, and fixed app.js/styles.css names. Run "npm test && npm run build"; verify dist contains the four expected files. Commit:

    git add webui/package.json webui/package-lock.json webui/tsconfig.json webui/vite.config.ts webui/src webui/public webui/tests webui/index.html
    git commit -m "feat(webui): add Vue Vite foundation and API client"

## Task 2: Runner State, Output Decoding, and History

**Files:**
- Create: webui/src/composables/useRunner.ts, webui/src/composables/useRunHistory.ts, webui/src/state/status.ts
- Create: webui/src/components/JobTimeline.vue, webui/src/components/OutputTabs.vue, webui/src/components/OutputViewer.vue
- Create: webui/tests/useRunner.test.ts, webui/tests/outputTabs.test.ts

- [ ] Write red tests for boot/load/retry, submit/poll, stop/resume, terminal completion, error recovery, and stale-generation protection. Assert Stop polling never says the backend job was canceled.
- [ ] Implement useRunner with one current task owner, a monotonically increasing generation, abort controllers for browser polling only, and phases booting, ready, submitting, polling, stopped, completed, and error.
- [ ] Define the exact terminal set: succeeded, compile failed, runtime failed, time limit, memory limit, output limit, canceled, and system error. Unknown non-empty statuses remain pollable.
- [ ] Preserve previous output on errors, clear it only on a deliberate new submission, and prevent old finally callbacks from changing the current generation.
- [ ] Implement in-memory history capped at 20 entries. A history selection restores source/result without contacting the API; do not persist source or output in localStorage.
- [ ] Implement four accessible output tabs: Output, Errors, Compile, Diagnostics. Decode base64 with TextDecoder({ fatal: true }); on invalid bytes retain the raw value, mark the channel undecodable, and never silently replace bytes. Show truncation only when the corresponding API flag is present.
- [ ] Run "cd webui && npm test", then commit:

    git add webui/src/composables webui/src/state webui/src/components/JobTimeline.vue webui/src/components/OutputTabs.vue webui/src/components/OutputViewer.vue webui/tests
    git commit -m "feat(webui): add runner state and output inspection"

## Task 3: Workbench Components and CodeMirror

**Files:**
- Create: webui/src/App.vue, webui/src/main.ts
- Create: webui/src/components/AppHeader.vue, ConnectionStatus.vue, HeaderActions.vue, WorkbenchShell.vue
- Create: webui/src/components/RunHistory.vue, RunHistoryItem.vue, SourceWorkbench.vue, WorkbenchToolbar.vue
- Create: webui/src/components/RuntimeSelect.vue, RunControls.vue, SourceEditor.vue, InspectorPanel.vue
- Create: webui/src/components/RuntimeInspector.vue, JobInspector.vue, DiagnosticSummary.vue
- Create: webui/src/editor/language.ts
- Create: webui/tests/SourceEditor.test.ts, webui/tests/workbench.test.ts

- [ ] Write component tests for runtime selection, source editing, Run/Stop/Resume controls, history selection, inspector metadata, live status, and text-only server output.
- [ ] Wrap CodeMirror 6 with line numbers, history, search, bracket matching, close brackets, and language extensions for JavaScript/TypeScript/Python/Go/Rust/C/C++/Java/JSON. Unknown runtimes use plain text; destroy the editor on unmount.
- [ ] Compose a desktop 232-256px / minmax(0,1fr) / 288-320px shell. Keep history/inspector outside the central scroll region and ensure min-width: 0 on text-bearing children.
- [ ] Add Lucide icon buttons with accessible labels/tooltips. Show connection state, runtime fields from the real adapter, job ID/status, duration, exit code, signal, truncation, encoding, and limits.
- [ ] Run "cd webui && npm test && npm run build && node --check dist/app.js"; commit:

    git add webui/src webui/tests
    git commit -m "feat(webui): build Vue runner workbench"

## Task 4: Visual System, Responsive Sheets, Themes, Accessibility

**Files:**
- Create: webui/src/styles/tokens.css, base.css, workbench.css, editor.css, output.css, sheets.css
- Create: webui/src/composables/useTheme.ts, useMediaLayout.ts, webui/src/components/EdgeSheet.vue
- Create: webui/tests/theme.test.ts, webui/tests/accessibility.test.ts
- Modify: workbench components for semantic classes and ARIA wiring

- [ ] Add tests for light/dark token selectors, reduced motion, desktop/mobile tracks, accessible icon names, and tab/tabpanel relations.
- [ ] Implement warm-neutral light/dark tokens with rose accent, semantic success/warning/danger/info colors, 4-8px radii, 1px rules, restrained grid texture, and no full-screen gradient/orb decoration.
- [ ] Implement desktop grid, tablet edge sheets, and mobile single-column flow below 768px. Keep editor height, toolbar height, output regions, and buttons stable; long IDs and output wrap inside their own regions.
- [ ] Persist only explicit theme choice; honor system preference initially. Remove transforms/pulses under prefers-reduced-motion: reduce.
- [ ] Run "cd webui && npm test && npm run build && git diff --check"; commit:

    git add webui/src webui/tests
    git commit -m "feat(webui): add responsive workbench visual system"

## Task 5: Deterministic Build and GitHub Pages

**Files:**
- Modify: webui/vite.config.ts, .github/workflows/pages.yml, scripts/pages-artifact-test.sh
- Create: scripts/webui-build-test.sh, webui/tests/build-contract.test.mjs
- Modify: webui/README.md

- [ ] Write a build-contract test that runs npm ci and npm run build, requires exactly four regular files in dist, rejects nested assets/source maps/tests/lockfiles/symlinks, and checks config-before-app order.
- [ ] Configure fixed Vite output and fail on extra files. Ensure config.js is copied from public and the generated index references relative fixed files.
- [ ] Update Pages to use pinned setup-node/cache, npm ci, unit tests, build, copy webui/dist, generate config from vars.SANDKASTEN_API_BASE_URL, run artifact checks, and deploy. Keep /Sandkasten/ and never embed secrets.
- [ ] Run "npm ci && npm test && npm run build && bash scripts/webui-build-test.sh && bash scripts/pages-artifact-test.sh --test"; commit:

    git add .github/workflows/pages.yml scripts/pages-artifact-test.sh scripts/webui-build-test.sh webui/vite.config.ts webui/tests/build-contract.test.mjs webui/README.md
    git commit -m "ci(webui): build Vue app for GitHub Pages"

## Task 6: Installer Boundary and Documentation

**Files:**
- Modify: werkzeug/installer/webui.sh, werkzeug/uninstall.sh, werkzeug/tests/webui-install.sh, werkzeug/tests/uninstall-webui.sh, werkzeug/quality/test.sh
- Modify: README.md, handbuch/deployment.md, handbuch/architecture.md, handbuch/api.md, docs/superpowers/specs/2026-08-19-installer-webui-design.md

- [ ] Add red installer fixtures: source with webui/src but no webui/dist must fail; a four-file dist must succeed; extra files, symlinks, and unmanaged paths must remain rejected.
- [ ] Make installation validate and atomically copy only webui/dist/index.html, app.js, styles.css, and config.js. Preserve marker ownership, Nginx templates, safe root guards, and unmanaged-file protection.
- [ ] Keep uninstall marker-gated and add WebUI unit/build/artifact tests to the quality path without invoking npm during server installation.
- [ ] Update docs with Vue commands, Pages build flow, fixed dist payload, no-Node installer behavior, HTTPS/CORS/API-base restrictions, and Stop polling semantics. Run focused installer and docs checks; commit:

    git add werkzeug README.md handbuch docs/superpowers/specs/2026-08-19-installer-webui-design.md
    git commit -m "feat(install): deploy the Vue WebUI distribution"

## Task 7: Browser Acceptance and Deployment

**Files:**
- Create: scripts/webui-browser-smoke.mjs
- Modify: webui/README.md only if browser setup documentation is required

- [ ] Start a local server for webui/dist plus a mock API and use Playwright at 1440x900, 1024x768, and 390x844. Assert visible editor/runtime/output, no horizontal overflow, no intersecting controls, and working history/inspector sheets.
- [ ] Cover light/dark/reduced-motion, runtime-load failure, queued/polling, Stop/Resume, success, compile/runtime failure, resource limits, invalid JSON, and HTTP message errors. Confirm all API-controlled output is text-only.
- [ ] Run the complete suite:

    cd webui && npm ci && npm test && npm run build
    cd ..
    bash scripts/webui-build-test.sh
    bash scripts/pages-artifact-test.sh --test
    bash werkzeug/tests/webui-install.sh
    bash werkzeug/tests/uninstall-webui.sh
    bash werkzeug/quality/test.sh
    node scripts/webui-browser-smoke.mjs
    git diff --check

- [ ] Review screenshots and layout assertions, fix only scoped issues, commit the smoke test, push feat/vue-webui-redesign, and verify the Actions run plus live https://diewehmut.github.io/Sandkasten/.

## Self-Review

- [ ] Every design section maps to a task.
- [ ] Runtime fields, job fields, encoding fallback, history ownership, and stale-generation behavior are explicit.
- [ ] Pages and installer consume the same four-file webui/dist boundary.
- [ ] Same-origin config, eight terminal statuses, text-only rendering, API security, and Stop polling semantics remain intact.
- [ ] Desktop/tablet/mobile screenshots and browser state coverage are explicit.
