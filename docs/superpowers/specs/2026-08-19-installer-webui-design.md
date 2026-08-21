# Installer and WebUI Design

## Goal

Provide one supported one-click installer that lets an operator choose a
deployment mode (`cli` or `webui`) and a set of language runtimes.  The
existing `werkzeug/deploy.sh` command surface remains compatible while the
implementation is split into focused installer modules.  WebUI mode installs
the repository's browser client and serves it through Nginx; CLI mode installs
the API and runner without static assets.

## Current Context

The installer has been split into focused modules while retaining the
`werkzeug/deploy.sh` compatibility surface. The browser client is now a Vue 3,
TypeScript, and Vite project under `webui/`; source and package metadata remain
development inputs, while a deterministic four-file `webui/dist/` directory is
the only installer and Pages payload.

## Architecture

### Installer entrypoints

- `werkzeug/install.sh` is the documented one-liner entrypoint.
- `werkzeug/deploy.sh` stays as a compatibility wrapper and forwards all
  arguments to `install.sh`.
- `werkzeug/installer/entrypoint.sh` parses `--mode`, `--languages`,
  `--non-interactive`, and the existing subcommands (`install`, `status`,
  `restart`, `uninstall`, `languages`, `domain`).
- `werkzeug/installer/backend.sh` owns the existing backend build, database,
  environment, and systemd operations by sourcing the guarded legacy
  implementation.  It exposes stable functions instead of duplicating those
  operations.
- `werkzeug/installer/languages.sh` owns the language catalog and selection
  contract.  It accepts numeric selections, ranges, names, and `core`/`web`/
  `all`; `--languages` bypasses the prompt but still validates names.
- `werkzeug/installer/webui.sh` owns static asset installation and the Nginx
  site template.  It is called only for `webui` mode.

The installer passes mode through an explicit `SANDKASTEN_INSTALL_MODE`
variable and writes `SANDKASTEN_INSTALL_MODE` and
`SANDKASTEN_RUNTIME_LANGUAGES` to the API environment.  This makes the chosen
mode inspectable and keeps reconfiguration idempotent.

### WebUI

`webui/` contains a Vue 3/TypeScript source project and a fixed production
distribution:

- `src/`, `tests/`, `package.json`, and the lockfile are development inputs.
- `npm ci`, `npm test`, and `npm run build` produce and verify the client.
- `dist/` contains exactly `index.html`, `app.js`, `styles.css`, and
  `config.js`; no nested assets, source maps, tests, package files, or symlinks
  are permitted.
- Pages and the self-hosted installer consume the same four-file boundary.

The client uses same-origin relative URLs.  Nginx serves files from
`/opt/sandkasten/webui` and proxies `/v1/` and `/healthz` to the API.  No
frontend package manager or network download is needed during server
installation. Stop polling affects only browser monitoring and never claims
that the backend job was canceled.

### Modes

- `cli`: install backend services and expose the configured API HTTP port;
  do not install WebUI files or create a static-site Nginx location.
- `webui`: perform the same backend install, validate and atomically copy only
  the checked-in `webui/dist/` files to the configured WebUI root, install
  Nginx, and configure a same-origin site. A domain/HTTPS prompt remains
  optional.

Interactive invocation asks for the mode before language selection.  A
non-interactive invocation must provide `--mode` and `--languages`, or use
documented defaults (`cli` and `core`) when explicitly requested by the caller.

## Error Handling and Security

- Unknown modes, empty language selections, malformed ranges, and invalid
  language names fail before package installation.
- Existing checksum and retry behavior for downloaded toolchains is retained.
- WebUI output is inserted with `textContent`; job artifacts are untrusted.
- Nginx proxy headers and timeouts follow the existing deployment defaults.
- WebUI installation validates all four required regular files and rejects a
  missing distribution, extra entries, directories, and symlinks before
  staging. It copies each expected file to a temporary sibling directory and
  renames the complete tree into place; a failed validation or copy leaves the
  previous installation intact.
- Uninstall removes the WebUI root and Nginx site only when those paths were
  created by Sandkasten. Ownership requires a real directory and a regular,
  non-symlink marker with the exact Sandkasten marker value; unmanaged user
  data is preserved even in purge flows.
- Cross-origin Pages configuration accepts only a public HTTPS API base and
  requires the API CORS allow-list to include the Pages origin. Browser static
  configuration never contains API credentials.

## Testing and Acceptance

- Shell tests verify mode parsing, language parsing, non-interactive behavior,
  and that CLI mode does not emit a WebUI Nginx location.
- WebUI unit/component tests verify API behavior, runner state, and safe text
  rendering; build-contract tests verify the exact distribution.
- Installer fixtures reject missing, extra, nested, and symlinked payloads and
  demonstrate that server installation does not invoke Node/npm.
- The canonical quality path runs existing Go/Rust tests plus WebUI dependency
  installation, unit tests, production build, distribution freshness, and
  Pages artifact checks.
- A dry-run installer invocation demonstrates both mode branches without
  requiring root or package downloads.
- Documentation includes the one-liner, mode examples, language selection
  syntax, layout, and uninstall behavior.
