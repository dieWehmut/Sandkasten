# Vue Setup Welcome And Bilingual Green UI Design

**Date:** 2026-08-21
**Status:** Approved direction

## 1. Purpose

Make the first visit to the Sandkasten Vue WebUI useful to an operator who
has not installed the service yet. The first screen becomes a dismissible
setup welcome page that explains the supported host, produces the real
installer commands, and points to post-install verification. Existing users
can enter the runner immediately after dismissing it and can reopen the guide
from the application header.

The same release adds a small English/Chinese locale layer and changes the
visual accent from rose to a restrained green system. The runner remains the
primary product surface after setup is dismissed.

## 2. Boundaries

The browser cannot execute `sudo`, install packages, or observe installer
progress. The setup page is therefore a read-only guide with copyable commands
and links, and must explicitly say that installation happens in a Debian or
Ubuntu terminal. It must not imply that a browser action installed the backend.

The guide is based on the supported `werkzeug/install.sh` and
`werkzeug/installer/entrypoint.sh` contracts. It exposes CLI and WebUI modes,
language presets, host prerequisites, service verification, maintenance, and
safe uninstall preview. It does not add an installer API or persist secrets.

## 3. First-visit flow

1. On a new browser profile, `App` renders `SetupWelcome` instead of the
   runner. The page has a clear mode choice, a short prerequisite summary,
   the first install command, and a primary **Enter workbench** action.
2. Entering the workbench writes `sandkasten-install-guide-seen=true` to
   local storage. A **Setup guide** header action reopens the page without
   clearing runner state.
3. The selected locale is independent of the seen flag. A locale change
   updates visible static copy immediately, persists under
   `sandkasten-locale`, and synchronizes `document.documentElement.lang`.
4. On compact layouts, the guide uses normal document flow and never creates
   horizontal overflow. It is not a nested card stack inside the runner.

## 4. Setup information architecture

The page is composed from focused pieces:

- `SetupWelcome.vue`: first-visit shell, mode selection, entry action.
- `InstallModeToggle.vue`: CLI/WebUI mode choice with accessible labels.
- `InstallStepList.vue`: ordered, localized steps matching the real deployer.
- `CopyCommand.vue`: code block and clipboard action with success/error state.
- `SetupGuide.vue`: reusable guide view opened from the header after first use.

The steps are:

1. Supported host: Linux x86_64, Debian/Ubuntu, root or sudo, apt, systemd,
   PostgreSQL, cgroup v2, and network access.
2. Select CLI or WebUI deployment mode and a runtime preset.
3. Run the curl bootstrap command or an explicit repository command.
4. Let the installer provision dependencies, selected toolchains, database,
   binaries, environment files, and systemd units.
5. For WebUI mode, configure Nginx, `/v1/`, `/healthz`, domain, and HTTPS.
6. Verify services with `systemctl`, `/healthz`, and `/v1/runtimes`.
7. Maintain with `status`, `restart`, `languages`, `reconfigure`, and
   `domain`; preview destructive cleanup with `uninstall --dry-run` first.

The guide includes a warning that Pages configuration is public, API tokens
must not be placed in `config.js`, and cross-origin APIs require CORS.

## 5. Locale architecture

`src/i18n/messages.ts` contains typed `en` and `zh-CN` catalogs for all
frontend-owned static labels, accessible names, statuses, empty states, and
setup copy. Runtime names, job output, diagnostics, and server-provided error
messages remain unchanged text.

`src/composables/useLocale.ts` mirrors `useTheme`: it detects the browser
language (`zh`, `zh-CN`, or `zh-TW` maps to Chinese; all else maps to English),
persists the selection, exposes a readonly locale and translator, and accepts
an injectable storage/navigator/document environment for tests. Components
receive a translator through a small app-level provider to avoid duplicating
locale props through every workbench layer. Stable `data-testid` attributes
remain language-independent for browser tests.

## 6. Green visual system

Replace the rose accent tokens with:

- light canvas `#f3f7f3`, surface `#ffffff`, text `#17231b`, muted text
  `#607064`, border `#d5e0d6`, accent `#23834a`, accent strong `#176235`,
  focus `#42b96b`;
- dark canvas `#101a14`, surface `#17231b`, subtle surface `#203128`, text
  `#e8f3ea`, muted text `#a9bcae`, border `#33483a`, accent `#63d58a`,
  accent strong `#8be8a8`, focus `#3fbf70`.

Success stays green but uses a distinct semantic token; danger remains red,
warning remains amber, and info remains blue. No gradients, decorative blobs,
or monochrome status-only cues are introduced. Focus rings and text contrast
must remain visible in both themes.

## 7. Testing and delivery

- Unit tests cover locale detection, persistence, HTML language updates, and
  catalog fallback.
- Component tests cover first-visit gating, mode-dependent commands, ordered
  steps, clipboard feedback, header reopening, and translated labels.
- Browser smoke keeps the existing English run scenario and adds a Chinese
  switch, setup-page visit, copy interaction, theme checks, and mobile overflow
  assertions.
- `npm run build`, exact four-file distribution checks, and installer tests
  remain mandatory. The committed `webui/dist` payload is regenerated only in
  the final integration commit.

Delivery is split into commits for locale foundation, green tokens, setup
components, app/header integration, tests, and regenerated distribution.
