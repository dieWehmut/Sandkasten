# Tray release check and local version sync plan

> **For agentic workers:** Use superpowers:subagent-driven-development for isolated tasks and reviews. Steps use checkboxes to track progress.

**Goal:** Ship the tray release check, prove it in a running app, bring this
computer onto the newest build, and push.

**Architecture:** Keep the release check in its own desktop module, own the
menu entry from the tray, and let an inert-by-default probe expose the native
menu and dialog to the end-to-end run.

**Tech Stack:** Electron 38, Node.js, Vue 3, Playwright (Electron), NSIS.

**Spec:** `docs/superpowers/specs/2026-09-20-tray-release-sync-design.md`

## Global constraints

- Preserve `apps/{web,cli,desktop}` and the four-file WebUI payload.
- Keep browser, Pages, and desktop behavior aligned; no desktop-only UI fork.
- The check is public, credential-free, and never trusts a server URL.
- Test each behavior before claiming it works; never substitute a stub for a
  real interactive check.
- Focused commits, isolated worktrees, integration after the gates pass, push
  only at the end.

## Task 1: Tray release check

Files: `apps/desktop/src/updates.mjs`, `tray.mjs`, `main.mjs`, unit tests.

- [x] Compare versions with semver rules and treat build metadata as equal.
- [x] Ask only the fixed public release API, ignore drafts and prereleases, and
      build the release URL from the validated tag.
- [x] Coalesce repeated clicks, release the busy state after a failure, and
      report an offline check as an error instead of claiming the build is new.
- [x] Offer the tray entry, rebuild the native menu around the check, and open
      the release page only when the download button is chosen.

## Task 2: End-to-end tray verification

Files: `apps/desktop/src/tray-probe.mjs`, `scripts/e2e-tray-update.mjs`,
`scripts/e2e-ide.mjs`, unit tests.

- [x] Publish the live tray menu and answer the update dialog only when the run
      asks for the probe; keep a normal launch inert.
- [x] Drive the real menu entry from a running app and assert the likely
      progress label, the settled entry, and the reported versions.
- [x] Cover an available update, a running-latest result, and the real GitHub
      API (`SANDKASTEN_E2E_RELEASE=live`).

## Task 3: Integration, local sync, and delivery

Files: desktop README, design docs, installer, installed build.

- [x] Run the desktop, web, CLI, layout, Pages, build, and browser gates.
- [x] Package the Windows installer, verify its payload, and run the packaged
      end-to-end suites.
- [x] Install the verified build on this computer and prove the installed copy
      reaches the real release API from the tray.
- [ ] Merge the branches into main, push, and publish the refreshed release.
