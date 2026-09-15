# Vue Setup Welcome And Bilingual Green UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-visit installation guide, English/Chinese switching, and a green visual system to the Vue WebUI while preserving the runner and four-file deployment contract.

**Architecture:** Add a typed locale catalog and `useLocale` composable at the app boundary, then provide a translator to existing components through a typed Vue injection key. Keep installer content in pure setup-data modules and render it with focused setup components. Keep the guide read-only because installation is performed in a terminal, not by the browser.

**Tech Stack:** Vue 3, TypeScript, Vite, Vitest, Vue Test Utils, Node browser smoke, CSS custom properties.

---

### Task 1: Commit the approved design and plan

**Files:**
- Create: `docs/superpowers/specs/2026-08-21-vue-setup-locale-design.md`
- Create: `docs/superpowers/plans/2026-08-21-vue-setup-locale.md`

- [ ] Review the design for scope and safety: the guide is read-only, uses `werkzeug/install.sh`, never persists secrets, and leaves the runner as the post-setup surface.
- [ ] Commit both documents:

```sh
git add docs/superpowers/specs/2026-08-21-vue-setup-locale-design.md docs/superpowers/plans/2026-08-21-vue-setup-locale.md
git commit -m "docs(webui): plan setup guide and bilingual green redesign"
```

### Task 2: Add locale catalog and composable (TDD)

**Files:**
- Create: `webui/src/i18n/messages.ts`
- Create: `webui/src/i18n/locale.ts`
- Create: `webui/src/composables/useLocale.ts`
- Test: `webui/tests/locale.test.ts`

- [ ] Write tests for English fallback, Chinese browser detection, unsupported stored values, persistence, `html.lang`, and missing-key fallback.
- [ ] Run `npx vitest run tests/locale.test.ts` and confirm the new test fails because the modules do not exist.
- [ ] Implement typed `Locale`, catalog keys, `createTranslator`, and `useLocale(environment?)`; detect `navigator.language`, persist `sandkasten-locale`, and update `document.documentElement.lang`.
- [ ] Run `npx vitest run tests/locale.test.ts tests/theme.test.ts`.
- [ ] Commit: `feat(webui): add persisted English Chinese locale layer`.

### Task 3: Replace rose tokens with green visual tokens

**Files:**
- Modify: `webui/src/styles/tokens.css`
- Modify: `webui/src/styles/base.css`
- Test: `webui/tests/styles.test.ts`

- [ ] Add failing assertions for light/dark green accent and focus tokens, distinct danger/warning colors, and absence of rose accent values.
- [ ] Run `npx vitest run tests/styles.test.ts` and confirm failure.
- [ ] Implement the approved green light/dark values, retaining semantic red, amber, and blue states and reduced-motion behavior.
- [ ] Run `npx vitest run tests/styles.test.ts tests/theme.test.ts`.
- [ ] Commit: `style(webui): shift workbench palette to accessible green`.

### Task 4: Add setup data and copyable command components

**Files:**
- Create: `webui/src/setup/installGuide.ts`
- Create: `webui/src/components/CopyCommand.vue`
- Create: `webui/src/components/InstallStepList.vue`
- Test: `webui/tests/installGuide.test.ts`
- Test: `webui/tests/CopyCommand.test.ts`

- [ ] Write failing tests for ordered setup steps, CLI/WebUI command differences, no secret values, clipboard invocation, and copy success/failure feedback.
- [ ] Run the focused tests and confirm failure.
- [ ] Implement the real curl bootstrap command plus explicit `--mode`/`--languages` examples; render command text as text/code, never HTML, with stable test IDs.
- [ ] Run the focused tests and commit: `feat(webui): add safe copyable installation guide content`.

### Task 5: Build the first-visit setup page

**Files:**
- Create: `webui/src/components/InstallModeToggle.vue`
- Create: `webui/src/components/SetupGuide.vue`
- Create: `webui/src/components/SetupWelcome.vue`
- Create: `webui/src/composables/useSetupWelcome.ts`
- Test: `webui/tests/setupWelcome.test.ts`

- [ ] Write failing tests for unseen users, dismiss persistence, reopen behavior, mode-specific commands, and compact-layout semantics.
- [ ] Run `npx vitest run tests/setupWelcome.test.ts` and confirm failure.
- [ ] Implement a read-only guide with Debian/Ubuntu, sudo, systemd, cgroup v2, disk, and network warnings; persist only the seen flag.
- [ ] Run setup component tests and commit: `feat(webui): add first-visit setup welcome flow`.

### Task 6: Localize the shell and expose setup actions

**Files:**
- Modify: `webui/src/main.ts`
- Modify: `webui/src/App.vue`
- Modify: `webui/src/components/AppHeader.vue`
- Modify: `webui/src/components/HeaderActions.vue`
- Modify: `webui/src/components/ConnectionStatus.vue`
- Modify: `webui/src/components/WorkbenchShell.vue`
- Create: `webui/src/components/LocaleSwitcher.vue`
- Test: `webui/tests/accessibility.test.ts`
- Test: `webui/tests/workbench.test.ts`

- [ ] Add failing integration assertions for translator provision, Chinese labels, first-visit setup, and header reopening.
- [ ] Run focused integration tests and confirm failure.
- [ ] Integrate locale and setup at the app boundary; keep stable language-independent test IDs.
- [ ] Replace frontend-owned English strings in shell, controls, tabs, history, inspectors, statuses, and empty states with catalog keys. Leave runtime names, output, diagnostics, and API payload text untouched.
- [ ] Run `npm test` and commit: `feat(webui): localize workbench and expose setup guide`.

### Task 7: Add browser acceptance

**Files:**
- Modify: `scripts/webui-browser-smoke.mjs`
- Modify: `scripts/tests/webui-browser-smoke.test.mjs`
- Modify: `webui/README.md`

- [ ] Add failing contracts for fresh setup visibility, command copy, dismissal persistence, header reopen, Chinese switch, theme checks, and 390px overflow.
- [ ] Run `node --test scripts/tests/webui-browser-smoke.test.mjs` and confirm failure.
- [ ] Implement deterministic fresh-context setup flow; use stable IDs/roles instead of translated text.
- [ ] Run `npm run build` and `npm run test:browser`.
- [ ] Commit: `test(webui): cover setup welcome and Chinese browser flow`.

### Task 8: Regenerate distribution and run integration checks

**Files:**
- Modify: `webui/dist/index.html`
- Modify: `webui/dist/app.js`
- Modify: `webui/dist/styles.css`
- Modify: `webui/dist/config.js`

- [ ] Run `cd webui; npm run build`.
- [ ] Run `bash scripts/webui-build-test.sh --test`, `bash scripts/pages-artifact-test.sh --test`, `bash werkzeug/tests/webui-install.sh`, and `bash werkzeug/tests/uninstall-webui.sh`.
- [ ] Run `npx tsc --noEmit`, `npm test`, and `npm run test:browser`.
- [ ] Commit: `build(webui): publish setup locale green redesign`.

### Task 9: Review, merge, push, and verify Pages

- [ ] Run `git diff --check origin/main...HEAD` and confirm a clean status.
- [ ] Request requirements and code-quality review for the complete branch; resolve all important findings.
- [ ] Push `feat/vue-webui-setup-locale`.
- [ ] From clean `release-main`, fast-forward main, merge with `--no-ff`, rerun WebUI tests/build, and push `main`.
- [ ] Confirm the GitHub Pages run and HTTP 200 for the page and four static resources.
