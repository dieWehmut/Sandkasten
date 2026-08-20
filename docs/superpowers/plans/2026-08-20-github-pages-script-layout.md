# GitHub Pages 与脚本布局实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the dependency-free WebUI to GitHub Pages through GitHub Actions and reorganize Werkzeug scripts without breaking existing commands.

**Architecture:** A Pages workflow copies `webui/` into a static artifact and injects a runtime API-base configuration. The browser client resolves all API paths against that optional base. Operational scripts move by responsibility while compatibility wrappers remain at the three public installer paths and other historical paths.

**Tech Stack:** GitHub Actions Pages artifacts, static HTML/CSS/ES modules, Bash wrappers, Node test runner.

---

### Task 1: Pages runtime configuration

**Files:**
- Create: `webui/config.js`
- Modify: `webui/index.html`, `webui/app.js`, `webui/test.mjs`

- [ ] Write a failing test for configured absolute API URLs and same-origin fallback.
- [ ] Run the Node test and confirm the new assertion fails.
- [ ] Add a small runtime config contract and URL resolver.
- [ ] Run Node tests and syntax checks.
- [ ] Commit as `feat(webui): support configurable Pages API origin`.

### Task 2: GitHub Pages workflow

**Files:**
- Create: `.github/workflows/pages.yml`
- Create: `webui/README.pages.md` or update `webui/README.md`

- [ ] Add push/manual workflow with Pages permissions and official artifact/deploy actions.
- [ ] Build a staging directory without installing frontend dependencies.
- [ ] Generate configuration from `vars.SANDKASTEN_API_BASE_URL` without embedding secrets.
- [ ] Add a local artifact test that checks required files and rejects accidental source trees.
- [ ] Commit as `ci: deploy webui through GitHub Pages`.

### Task 3: Development and quality script layout

**Files:**
- Move: `werkzeug/dev-up.sh`, `werkzeug/gen-proto.sh`, `werkzeug/docker-clean.sh`
- Move: `werkzeug/test.sh`, `werkzeug/lint.sh`
- Create: compatibility wrappers at the old paths
- Modify: `Makefile`, moved-script root discovery

- [ ] Add path assertions for wrappers and moved scripts.
- [ ] Move scripts and update their root calculations.
- [ ] Update Make targets and lint recursion.
- [ ] Run shell syntax and wrapper checks.
- [ ] Commit as `refactor(tooling): group development and quality scripts`.

### Task 4: Security and smoke script layout

**Files:**
- Move: security and smoke scripts into their responsibility directories.
- Create: compatibility wrappers and focused layout test.
- Modify: documentation and hard-coded references.

- [ ] Add failing reference/path tests before changing paths.
- [ ] Move scripts, update root discovery and internal references.
- [ ] Run installer, WebUI, smoke, and syntax checks.
- [ ] Commit as `refactor(tooling): group security and smoke scripts`.

### Task 5: Documentation, branch integration, and release verification

**Files:**
- Modify: `README.md`, translated handbooks, deployment/API docs as needed.

- [ ] Document Pages setup, required repository variable, CORS, and compatibility paths.
- [ ] Re-check all remote branches and merge only non-duplicate branches.
- [ ] Run complete verification and inspect the generated Pages artifact.
- [ ] Push the feature branch and report its exact SHA and URL.
- [ ] Commit as `docs: document GitHub Pages deployment and script layout`.
