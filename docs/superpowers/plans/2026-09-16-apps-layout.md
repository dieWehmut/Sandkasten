# Apps Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a root `apps/` directory containing `apps/web` (migrated WebUI), `apps/cli` (new local CLI), and `apps/desktop` (new Electron shell), mirroring the deepseek-harness apps layout, with every client still working from GitHub Pages, a local server install, the terminal, and the desktop.

**Architecture:** Each deliverable owns one `apps/<name>/` directory with its own source, tests, and packaging. The web app keeps its four-file `dist/` contract for Pages and the installer; the CLI is a dependency-free Node client over the HTTP API; the desktop app is an Electron shell that loads the built web distribution from disk and reuses the same `config.js` API contract.

**Tech Stack:** Vue 3 / Vite (existing), Node 22.18.0 ESM for web and CLI, Electron 38 for desktop, Node built-in test runner, Vitest, Bash checks, GitHub Actions Pages.

**Spec:** `docs/superpowers/specs/2026-09-16-apps-layout-design.md`

## Global Constraints

- Node release is pinned to `22.18.0` everywhere (CI and docs).
- `apps/web/dist/` must contain exactly `index.html`, `app.js`, `styles.css`, `config.js` as regular files, committed.
- `apps/web/public/config.js` keeps the exact line `globalThis.SANDKASTEN_CONFIG ??= { apiBaseUrl: '' };`.
- The Pages workflow writes `vars.SANDKASTEN_API_BASE_URL` into the deployed `config.js` as a JSON-escaped direct assignment; no secret may ever be embedded.
- Installer contract is unchanged: `werkzeug/install.sh --mode webui` still deploys to `/opt/sandkasten/webui` (override `SANDKASTEN_WEBUI_DIR`) with the `sandkasten-webui-managed` marker.
- Canonical repository URLs (`https://github.com/dieWehmut/Sandkasten`, jsDelivr, codeload) must remain intact in every README checked by `scripts/repository-path-test.sh`.
- Each task ends with its own verification and commit; branches are merged only after their tests pass.

## Branch And Commit Map

| Branch | Tasks | Base |
| --- | --- | --- |
| `docs/apps-layout-plan` | Spec and this plan | `main` |
| `feat/apps-web-migration` | T1-T5 | `main` |
| `feat/apps-cli` | T6-T8 | `main` |
| `feat/apps-desktop` | T9-T12 | `main` |
| `feat/apps-integration` | T13-T15 (merge + docs + guards) | merged tips |
| integration | merge `feat/apps-integration` into `main`, verify, push | `main` |

---

### Task 1: Move the WebUI tree into apps/web

**Files:**
- Move: `webui/**` -> `apps/web/**`
- Modify: `.gitignore`, `.gitattributes`

- [ ] Step 1: `git mv webui apps/web` and confirm `git status` shows renames only.
- [ ] Step 2: Update `.gitignore` payload exceptions from `webui/dist/*` to `apps/web/dist/*`.
- [ ] Step 3: Update `.gitattributes` from `webui/index.html` / `webui/dist/**` to `apps/web/...`.
- [ ] Step 4: Commit as `refactor(apps): move WebUI source and payload into apps/web`.

### Task 2: Retarget tooling, CI, and the installer to apps/web

**Files:**
- Modify: `.github/workflows/pages.yml`, `scripts/webui-build-test.sh`,
  `scripts/pages-artifact-test.sh`, `scripts/webui-browser-smoke.mjs`,
  `scripts/tests/webui-browser-smoke.test.mjs`
- Modify: `werkzeug/installer/webui.sh`, `werkzeug/quality/test.sh`
- Modify: `werkzeug/tests/webui-install.sh`, `werkzeug/tests/webui-mode.sh`,
  `werkzeug/tests/webui-domain.sh`, `werkzeug/tests/uninstall-webui.sh`,
  `werkzeug/tests/installer.sh`, `werkzeug/tests/installer-bootstrap.sh`

- [ ] Step 1: Update every live `webui/` path reference to `apps/web/` (keep the deployed `/opt/sandkasten/webui` root and `--mode webui` untouched).
- [ ] Step 2: Run `bash scripts/webui-build-test.sh --test` and `bash scripts/pages-artifact-test.sh --test`.
- [ ] Step 3: Run the installer fixtures with msys/GNU bash.
- [ ] Step 4: Commit as `build(apps): retarget CI, scripts, and installer to apps/web`.

### Task 3: Update documentation paths for the move

**Files:**
- Modify: `README.md`, `handbuch/README.en.md`, `handbuch/README.ja.md`,
  `handbuch/README.zh-TW.md`, `handbuch/architecture.md`, `handbuch/api.md`,
  `handbuch/deployment.md`, `apps/web/README.md`

- [ ] Step 1: Replace repository-side `webui/` references with `apps/web/`; keep installed-path wording.
- [ ] Step 2: Run `bash scripts/repository-path-test.sh`.
- [ ] Step 3: Commit as `docs(apps): update WebUI references to apps/web`.

### Task 4: Add a dependency-free local preview server

**Files:**
- Create: `apps/web/scripts/serve.mjs`, `apps/web/tests/serve.test.mjs`
- Modify: `apps/web/package.json`, `apps/web/README.md`

- [ ] Step 1: Write a failing test: serving `dist/` returns the four files, rejects traversal, and sets no-store caching.
- [ ] Step 2: Implement `serve.mjs` with `node:http`, port `4173` default, `--port`/`--host` flags.
- [ ] Step 3: Add `"serve": "node scripts/serve.mjs"`; screenshot-free smoke run against a temp dist.
- [ ] Step 4: Commit as `feat(web): add dependency-free local preview server`.

### Task 5: Lock the apps/web layout boundary

**Files:**
- Create: `scripts/apps-layout-test.sh`
- Modify: `werkzeug/quality/test.sh`

- [ ] Step 1: Assert `apps/web/dist` contains exactly four files and no stale top-level `webui/` directory exists.
- [ ] Step 2: Assert no live file references `webui/app.js`, `webui/styles.css`, or `webui/index.html`.
- [ ] Step 3: Wire the check into `werkzeug/quality/test.sh`; run it.
- [ ] Step 4: Commit as `test(apps): lock the apps/web layout boundary`.

### Task 6: Scaffold the CLI with runtime listing

**Files:**
- Create: `apps/cli/package.json`, `apps/cli/bin/sandkasten.mjs`,
  `apps/cli/src/args.mjs`, `apps/cli/src/api.mjs`, `apps/cli/src/output.mjs`,
  `apps/cli/tests/args.test.mjs`, `apps/cli/tests/api.test.mjs`,
  `apps/cli/tests/cli.test.mjs`, `apps/cli/README.md`

- [ ] Step 1: Write failing tests for argument parsing, URL/header construction, and `runtimes` output.
- [ ] Step 2: Implement args, api, output, and the `runtimes` command; make tests pass.
- [ ] Step 3: Run `node --test` in `apps/cli`.
- [ ] Step 4: Commit as `feat(cli): scaffold local CLI with runtime listing`.

### Task 7: Add run and job commands with polling

**Files:**
- Modify: `apps/cli/bin/sandkasten.mjs`, `apps/cli/src/api.mjs`, `apps/cli/src/output.mjs`
- Create: `apps/cli/tests/run.test.mjs`

- [ ] Step 1: Write failing tests: submit `{ source, wait: false }`, poll to terminal, print stdout/stderr/exit code, map exit codes (`0`/`1`/`3`).
- [ ] Step 2: Implement `run <file>` and `job <id>` plus `--json` printer.
- [ ] Step 3: Run `node --test` in `apps/cli`.
- [ ] Step 4: Commit as `feat(cli): submit sources and poll job results`.

### Task 8: CLI end-to-end smoke with a mock API

**Files:**
- Create: `apps/cli/tests/e2e.test.mjs`
- Modify: `apps/cli/README.md`

- [ ] Step 1: Spawn `bin/sandkasten.mjs` against an in-process mock HTTP server; assert stdout, stderr, and exit codes.
- [ ] Step 2: Document commands, environment, and exit codes in the README.
- [ ] Step 3: Run the full CLI suite.
- [ ] Step 4: Commit as `test(cli): cover end-to-end run flow against a mock API`.

### Task 9: Scaffold the Electron desktop shell

**Files:**
- Create: `apps/desktop/package.json`, `apps/desktop/src/main.mjs`,
  `apps/desktop/src/preload.mjs`, `apps/desktop/src/navigation.mjs`,
  `apps/desktop/tests/navigation.test.mjs`, `apps/desktop/README.md`

- [ ] Step 1: Write failing unit tests for navigation policy and window options.
- [ ] Step 2: Implement main/preload with contextIsolation, sandbox, and external-origin denial.
- [ ] Step 3: Run `node --test` in `apps/desktop`.
- [ ] Step 4: Commit as `feat(desktop): scaffold Electron shell for the bundled WebUI`.

### Task 10: Resolve the bundled distribution and fail closed

**Files:**
- Create: `apps/desktop/src/distribution.mjs`, `apps/desktop/tests/distribution.test.mjs`
- Modify: `apps/desktop/src/main.mjs`

- [ ] Step 1: Write failing tests for dev and packaged resolution plus missing-dist failure.
- [ ] Step 2: Implement resolution (`../web/dist`, `process.resourcesPath/web-dist` when packaged) and an error dialog + non-zero exit.
- [ ] Step 3: Run `node --test` in `apps/desktop`.
- [ ] Step 4: Commit as `feat(desktop): load the bundled apps/web distribution`.

### Task 11: Packaging metadata

**Files:**
- Create: `apps/desktop/electron-builder.config.mjs`
- Modify: `apps/desktop/package.json`, `apps/desktop/README.md`

- [ ] Step 1: Configure electron-builder with `extraResources` for `apps/web/dist`.
- [ ] Step 2: Add `package:dir` script; document unsigned local packaging limits.
- [ ] Step 3: Commit as `build(desktop): add electron-builder packaging metadata`.

### Task 12: Headless window smoke

**Files:**
- Create: `apps/desktop/scripts/smoke.mjs`
- Modify: `apps/desktop/package.json`

- [ ] Step 1: Implement a smoke that launches Electron with `show: false`, loads the bundled `index.html`, and asserts the app shell marker.
- [ ] Step 2: Run `npm run smoke` on this Windows host.
- [ ] Step 3: Commit as `test(desktop): add headless window smoke`.

### Task 13: Merge the app branches

**Files:**
- Integration branch only

- [ ] Step 1: Create `feat/apps-integration` from the latest app branch tip; merge `feat/apps-web-migration`, `feat/apps-cli`, and `feat/apps-desktop` with merge commits.
- [ ] Step 2: Resolve conflicts toward the documented contracts; run the full web suite.
- [ ] Step 3: Commit as `merge: integrate apps/web, apps/cli, and apps/desktop`.

### Task 14: Root layout documentation

**Files:**
- Modify: `README.md`, `handbuch/architecture.md`, `apps/*/README.md` links

- [ ] Step 1: Document the `apps/` layout table (Pages web, local web, CLI, desktop) in the README and architecture handbook.
- [ ] Step 2: Run `bash scripts/repository-path-test.sh`.
- [ ] Step 3: Commit as `docs(apps): document web, cli, and desktop app layout`.

### Task 15: Cross-app verification and release

**Files:**
- Modify: `scripts/apps-layout-test.sh`, `werkzeug/quality/test.sh`

- [ ] Step 1: Extend the layout test to cover CLI entrypoint, desktop entrypoint, and dist bundle presence; wire into quality.
- [ ] Step 2: Run the full gate: web unit + build + browser smoke, `apps/cli` node tests, `apps/desktop` node tests + Electron smoke, installer fixtures, pages artifact, `go test ./...`, `cargo test --all`.
- [ ] Step 3: Commit as `test(apps): cover all app entrypoints in the layout gate`.
- [ ] Step 4: Merge `feat/apps-integration` into `main`, push `main` and all branches, and confirm the Pages workflow deploy.
