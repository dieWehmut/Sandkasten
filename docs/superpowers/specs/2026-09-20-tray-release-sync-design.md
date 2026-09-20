# Tray release check and local version sync

This continues session `01a0bea5-61b2-70f1-bd54-ecfa95db6609`, which asked for
a VS Code-led UI pass, a tray entry that checks the repository releases, and a
local copy of the app brought up to the newest build.

## Requested behavior

1. The UI keeps following the supplied VS Code references: the three-level
   workbench hierarchy, low-contrast neutral surfaces, the reduced title row,
   and the settings screen with its own section sidebar.
2. The tray menu carries `检查更新…` / `Check for updates…`. It asks the
   repository for the newest stable release, names the running and published
   versions, and reaches the release page only when an update exists and the
   reader chooses it.
3. This computer runs the newest build instead of the one installed before the
   UI work landed.

## Constraints

- Reuse the existing `apps/{web,cli,desktop}` layout and the four-file WebUI
  payload; keep one shared UI rather than a desktop-only fork.
- The release check reaches only the fixed public release API, without
  credentials, and never trusts a server-supplied URL as a target.
- A failed or offline check must not report the running build as current.
- Prove the tray behavior in a real running app, not only against stubs: the
  menu and the dialog are native surfaces the page driver cannot reach.
- Focused commits on isolated branches, integration after the checks pass, and
  a single push at the end.

## Design

The update check lives in `apps/desktop/src/updates.mjs`: it compares the
running version against the newest non-draft, non-prerelease release with a
proper semver comparison, builds its own release URL from the validated tag,
and coalesces repeated clicks. `tray.mjs` owns the menu entry, rebuilds the
native menu around the asynchronous check so it shows a disabled progress
label, and `main.mjs` wires both to the real tray and the real dialog.

Because no page-level driver can read a native menu or answer a native modal,
`apps/desktop/src/tray-probe.mjs` publishes the live tray menu and answers the
update dialog when the run sets `SANDKASTEN_E2E_PROBE`. The same probe can
serve a scripted release tag, an absent release, or leave the request on the
real GitHub API, so one end-to-end command proves the progress state, the
settled state, and the reported versions. Without that variable the probe is
inert and the app behaves exactly as before.
