# Apps Layout Design: apps/web, apps/cli, apps/desktop

## Context

Sandkasten currently ships three client surfaces, but only one of them lives in
a dedicated application directory:

- The Vue 3 workbench in `webui/`, published to GitHub Pages and copied into a
  server installation by `werkzeug/install.sh --mode webui`.
- The HTTP/gRPC API in `schnittstelle/`, which callers must drive by hand with
  `curl` or `grpcurl`.
- No desktop client at all.

The repository follows the multi-app layout of
<https://github.com/deepseek-ai/deepseek-harness/tree/master/apps>, which keeps
one directory per deliverable under a root `apps/` directory
(`apps/cli`, `apps/desktop`, `apps/web`). This design adopts that layout so each
client surface owns its source, tests, and packaging without entangling the
server components.

## Goal

Add a root `apps/` directory and migrate existing client files into it:

- `apps/web/` - the existing Vue workbench, moved from `webui/`. It remains the
  GitHub Pages artifact and the installer payload. The local web experience is
  unchanged except for its path.
- `apps/cli/` - a new local command-line client that submits source, polls jobs,
  and prints results through the existing HTTP API.
- `apps/desktop/` - a new Electron desktop shell that bundles the built
  `apps/web` distribution and talks to the same HTTP API.

## Architecture

### apps/web (migration)

Move `webui/` to `apps/web/` with `git mv` so history is preserved. The Vite
build keeps its contract: `apps/web/dist/` still contains exactly `index.html`,
`app.js`, `styles.css`, and `config.js`, `public/config.js` still uses the
nullish same-origin default, and the Pages workflow still injects
`vars.SANDKASTEN_API_BASE_URL` into the deployed copy of `config.js`.

Every live path reference must move with the app:

- `.github/workflows/pages.yml` (working directory, cache path, artifact path)
- `.gitignore` and `.gitattributes` (`apps/web/dist` payload exceptions)
- `scripts/pages-artifact-test.sh` and `scripts/webui-build-test.sh` checks
- `scripts/webui-browser-smoke*.mjs` distribution directory
- `werkzeug/installer/webui.sh` installed distribution source
- `werkzeug/quality/test.sh` test working directory
- `werkzeug/tests/*` fixtures that build a fake `webui/dist`
- `README.md` and `handbuch/*` command examples

The installer *destination* stays `/opt/sandkasten/webui` and the install mode
stays `webui`: it is the deployed site root and part of the public install
contract, not a source layout. Only the repository-side source path changes.

### apps/cli (new)

A dependency-free Node.js command-line client. Using the same runtime family as
the web build keeps the repository toolchain uniform (Node 22.18.0) and lets the
CLI reuse the exact HTTP contract the workbench already exercises: `GET
/v1/runtimes`, `POST /v1/{language}/run` with `{ source, wait: false }`, and
`GET /v1/jobs/{jobId}` polling until a terminal status.

Commands:

- `sandkasten run <file> [--language <lang>] [--api <url>] [--token <token>]
  [--entrypoint <path>] [--stdin <file>] [--poll-interval <ms>] [--json]`
- `sandkasten runtimes [--api <url>] [--token <token>] [--json]`
- `sandkasten job <jobId> [--api <url>] [--token <token>] [--json]`

Environment defaults: `SANDKASTEN_API_BASE_URL` and `SANDKASTEN_API_TOKEN`.
Exit codes are stable: `0` for a succeeded job or successful metadata command,
`1` for a failed job (compile/runtime/time/memory/output limit/system error),
`2` for usage errors, and `3` for transport/API errors. The CLI never reads
secrets from files and accepts tokens only through flags or environment.

The API module (`apps/cli/src/api.mjs`) is transport-only and receives a fetch
implementation so tests run without a live server. The printer (`src/output.mjs`)
keeps stdout as the program output channel and stderr for diagnostics, so
`--json` stays machine-readable.

### apps/desktop (new)

An Electron application that loads the built `apps/web` distribution from disk
and proxies no API traffic itself: the renderer keeps using the same runtime
`config.js` contract, defaulting to a same-origin API unless
`SANDKASTEN_API_BASE_URL` is set.

Structure follows the deepseek-harness desktop app conventions: a `src/main.mjs`
main process, a `src/preload.mjs` context-isolated bridge, a renderer that loads
`apps/web/dist`, and packaging metadata. Security defaults are Electron's
hardened set: `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true`, a strict `will-navigate`/`setWindowOpenHandler` deny list for
external origins (opened in the OS browser instead), and no remote module.

The desktop app resolves its bundled distribution at
`apps/web/dist` relative to the app root, so it always ships the same four files
as Pages and the installer. The main process must fail with a clear message if
that distribution is missing instead of falling back to a development server.

### Boundary summary

| Deliverable | Source | Local run | Published artifact |
| --- | --- | --- | --- |
| GitHub Pages web | `apps/web/src` | `npm run dev` | `apps/web/dist` deployed by `pages.yml` |
| Local web | `apps/web/src` | `npm run dev` or server install | `/opt/sandkasten/webui` copied by the installer |
| CLI | `apps/cli/src` | `node apps/cli/bin/sandkasten.mjs` | not published; run from checkout |
| Desktop | `apps/desktop/src` | `npm start` (Electron) | packaged app bundling `apps/web/dist` |

## Error handling

- CLI: usage errors print a short synopsis to stderr and exit `2`; API or
  network failures print the endpoint and message and exit `3`; a terminal job
  that did not succeed prints compile and runtime output to stderr and exits
  `1`. Polling stops on the eight existing terminal statuses and reports the
  status name for anything unknown.
- Desktop: a missing `apps/web/dist` or an Electron startup failure shows a
  dialog naming the missing path and exits non-zero; renderer navigation to any
  non-bundled origin is denied and handed to the OS browser.
- Migration: every moved path keeps a single source of truth. No wrapper shims
  are left in `webui/`; stale directories are deleted rather than duplicated.

## Testing

- `apps/web`: existing Vitest, Node test-runner, build-contract, Pages
  artifact, and Playwright browser-smoke suites keep passing after the move.
- `apps/cli`: Node's built-in test runner covers argument parsing, API URL and
  header construction, poll termination, JSON/text printing, and exit codes
  against an in-process mock HTTP server.
- `apps/desktop`: unit tests cover window options, navigation policy, and
  distribution resolution; a smoke check launches Electron headlessly when a
  display is available and asserts the window loads the bundled `index.html`.
- Repository checks: `scripts/webui-build-test.sh`, `scripts/pages-artifact-test.sh`,
  `werkzeug/tests/*`, `werkzeug/quality/test.sh`, `go test ./...`, and
  `cargo test --all` (Rust unaffected but run for the final gate).

## Verification

- `git mv` history is visible for every moved file.
- `git grep webui` shows only intentional references: the deployed site root
  `/opt/sandkasten/webui`, the `--mode webui` install mode, the
  `sandkasten-webui-managed` marker, and historical plan documents.
- The Pages workflow stages `apps/web/dist` and the artifact checker accepts it.
- The installer test fixtures build `apps/web/dist` and pass.
- `node apps/cli/bin/sandkasten.mjs runtimes --api http://127.0.0.1:PORT`
  round-trips against a mock server; a live smoke against a local API is run
  when one is available.
- The desktop app opens its window against the bundled distribution.
