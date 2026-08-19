# Installer and WebUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a tested one-click installer with selectable runtimes and explicit CLI/WebUI modes, plus a usable repository-owned WebUI.

**Architecture:** Keep `werkzeug/deploy.sh` as a compatibility shim while the new `werkzeug/install.sh` and `werkzeug/installer/` modules own argument parsing and mode-specific orchestration.  Reuse the existing backend provisioning functions behind a guarded source boundary.  Serve a dependency-free `webui/` static client through Nginx only in WebUI mode.

**Tech Stack:** Bash 5, systemd, Nginx, static HTML/CSS/JavaScript, Node's built-in test runner, existing Go/Rust build and test scripts.

---

### Task 1: Design and contract documents

**Files:**
- Create: `docs/superpowers/specs/2026-08-19-installer-webui-design.md`
- Create: `docs/superpowers/plans/2026-08-19-installer-webui.md`

- [x] Record current script boundaries, mode semantics, file layout, security rules, and acceptance tests.
- [x] Commit only the design and plan documents with `docs: design installer modes and webui`.

### Task 2: Static WebUI client

**Files:**
- Create: `webui/index.html`
- Create: `webui/app.js`
- Create: `webui/styles.css`
- Create: `webui/README.md`
- Create: `webui/test.mjs`

- [ ] Write `webui/test.mjs` first.  It must fail when `index.html`, `app.js`, or `styles.css` is absent and must assert that the client contains `/v1/runtimes`, `/v1/`, `textContent`, and a polling path.
- [ ] Run `node --test webui/test.mjs` and observe the expected failure before adding the client.
- [ ] Add an accessible editor layout with runtime select, source textarea, submit button, status, output, and error regions.
- [ ] Implement `loadRuntimes`, `submitJob`, and `pollJob` with relative same-origin URLs, abortable polling, explicit response validation, and `textContent` rendering for artifacts.
- [ ] Add responsive styles with stable controls and visible focus states.
- [ ] Run the Node test and a static syntax check (`node --check webui/app.js`).
- [ ] Commit as `feat(webui): add static job runner client`.

### Task 3: Installer module contracts and CLI parser

**Files:**
- Create: `werkzeug/installer/lib.sh`
- Create: `werkzeug/installer/languages.sh`
- Create: `werkzeug/installer/entrypoint.sh`
- Create: `werkzeug/install.sh`
- Modify: `werkzeug/deploy.sh`
- Create: `werkzeug/tests/installer.bats` (or an equivalent shell test runnable without Bats)

- [ ] Write shell tests for `parse_mode`, `parse_languages`, `--mode webui`, `--mode cli`, invalid modes, and numeric/range/name language selection.  Tests must run without root by sourcing the modules in test mode.
- [ ] Run the tests and observe failure for the missing parser functions.
- [ ] Implement strict mode parsing (`cli|webui`), explicit language validation, `--languages` CSV/range handling, and interactive fallbacks.  Keep `core`, `web`, and `all` presets identical to the existing catalog.
- [ ] Make `werkzeug/install.sh` exec the module entrypoint and make `werkzeug/deploy.sh` forward to it while preserving subcommands and `--help`.
- [ ] Run shell syntax checks and parser tests.
- [ ] Commit as `feat(install): add modular mode and language parser`.

### Task 4: Backend integration and WebUI deployment

**Files:**
- Modify: `werkzeug/installer/backend.sh`
- Create: `werkzeug/installer/webui.sh`
- Modify: `werkzeug/installer/entrypoint.sh`
- Modify: `werkzeug/deploy.sh` (only the guarded-source compatibility boundary)
- Modify: `werkzeug/uninstall.sh`
- Create: `werkzeug/tests/webui-install.sh`

- [ ] Add a failing dry-run test proving CLI mode skips WebUI paths and WebUI mode emits the static root and `/v1/` proxy configuration.
- [ ] Guard the legacy deploy main call so its functions can be sourced, then expose backend install/status/reconfigure operations through the module boundary.
- [ ] Implement atomic WebUI copy to `/opt/sandkasten/webui` (override with `SANDKASTEN_WEBUI_DIR`) and an Nginx template with same-origin `/v1/` and `/healthz` proxying.
- [ ] Write mode and language variables into API env files and restart only affected services after configuration changes.
- [ ] Extend uninstall/dry-run to remove WebUI artifacts and the managed Nginx site without deleting unrelated files.
- [ ] Run dry-run tests, `bash -n` on every installer script, and shellcheck when available.
- [ ] Commit as `feat(install): integrate cli and webui deployment modes`.

### Task 5: Operator documentation and examples

**Files:**
- Modify: `README.md`
- Modify: `handbuch/deployment.md`
- Modify: `handbuch/architecture.md`
- Modify: `handbuch/api.md`
- Modify: `handbuch/README.en.md`
- Modify: `handbuch/README.ja.md`
- Modify: `handbuch/README.zh-TW.md`

- [ ] Document the clone-free one-liner for `werkzeug/install.sh`, interactive mode selection, `--mode cli|webui`, `--languages`, presets, WebUI URL, environment overrides, and uninstall behavior.
- [ ] Add the directory map and same-origin API contract; state that job output is untrusted and rendered as text.
- [ ] Update translated deployment sections consistently without changing unrelated language-runtime content.
- [ ] Commit as `docs: document installer modes and webui`.

### Task 6: Verification and final review

**Files:** all changed files

- [ ] Run `node --test webui/test.mjs` and `node --check webui/app.js`.
- [ ] Run all installer shell tests and `bash -n werkzeug/install.sh werkzeug/deploy.sh werkzeug/installer/*.sh`.
- [ ] Run `./werkzeug/test.sh` and record the exit code and test counts.
- [ ] Exercise `./werkzeug/install.sh --help`, `--dry-run --mode cli --languages core`, and `--dry-run --mode webui --languages python,typescript` on a non-root host.
- [ ] Inspect `git diff --check`, `git status --short`, and the commit log; verify each requirement in the design has direct evidence.
- [ ] Request a final code review and address any findings before marking the goal complete.
