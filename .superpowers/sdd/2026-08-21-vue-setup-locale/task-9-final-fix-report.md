# Task 9 Final Fix Report

## Scope

- Removed `--non-interactive` from generated browser installer commands.
- Added localized, copyable repository, verification, lifecycle, domain, and dry-run uninstall commands.
- Made operational commands mode-aware; CLI verification targets the documented API port `127.0.0.1:8080`, while WebUI verification uses the same-origin proxy.
- Reused `InstallStepList` from `SetupGuide` with localized step titles and descriptions and restored shared step-number styling.
- Extended browser smoke to verify Chinese locale, setup dismissal persistence, reload persistence, localized editor label, then switch back to English.

## TDD Evidence

RED:

- `npx vitest run tests/installGuide.test.ts` initially failed because the real parser contract test exceeded the default 5s Vitest timeout on the Windows bash/WSL shim.
- Browser contract initially failed because its expected reload sequence did not include the persisted Chinese locale assertion.

GREEN:

- `npx vitest run tests/installGuide.test.ts` -> 10 tests passed.
- `node --test ../scripts/tests/webui-browser-smoke.test.mjs` -> 11 tests passed.
- `npx tsc --noEmit` -> exit 0.
- `git diff --check` -> clean.

The parser contract invokes the real `werkzeug/installer/entrypoint.sh --dry-run` using a cwd-relative POSIX path, avoiding Windows drive-letter conversion while remaining runnable from the WebUI package or repository root.

## Commits

- `6a49bac` - `fix(webui): localize setup operations and steps`
- `d058e21` - `test(webui): verify installer parser and locale reload`

## Residual Risk

- The full WebUI Vitest suite contains pre-existing environment-sensitive CodeMirror/App locale timeouts under the local Windows WSL localhost shim; focused tests for this fix and the browser contract pass.
- Browser screenshots and `webui/dist` were not rebuilt or modified, per the task constraint.
