# Installer and WebUI Design

## Goal

Provide one supported one-click installer that lets an operator choose a
deployment mode (`cli` or `webui`) and a set of language runtimes.  The
existing `werkzeug/deploy.sh` command surface remains compatible while the
implementation is split into focused installer modules.  WebUI mode installs
the repository's browser client and serves it through Nginx; CLI mode installs
the API and runner without static assets.

## Current Context

The repository already has a production-oriented, interactive
`werkzeug/deploy.sh`.  It knows how to select runtimes, install their tool
chains, build the Go API and Rust runner, provision PostgreSQL, and configure
systemd/Nginx.  It is currently a single large script and always treats Nginx
as an optional reverse proxy for the API.  There is no standalone frontend
directory.

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

`webui/` contains a dependency-free static client:

- `index.html` provides the accessible shell and status/output regions.
- `app.js` loads `/v1/runtimes`, submits source to
  `/v1/{language}/run`, polls `/v1/jobs/{id}`, and renders stdout/stderr and
  diagnostics without injecting untrusted output as HTML.
- `styles.css` provides a responsive, keyboard-friendly layout.
- `README.md` documents the same-origin API contract and local preview.

The client uses same-origin relative URLs.  Nginx serves files from
`/opt/sandkasten/webui` and proxies `/v1/` and `/healthz` to the API.  No
frontend package manager or network download is needed during installation.

### Modes

- `cli`: install backend services and expose the configured API HTTP port;
  do not install WebUI files or create a static-site Nginx location.
- `webui`: perform the same backend install, copy the checked-out `webui/`
  directory to the configured WebUI root, install Nginx, and configure a
  same-origin site.  A domain/HTTPS prompt remains optional.

Interactive invocation asks for the mode before language selection.  A
non-interactive invocation must provide `--mode` and `--languages`, or use
documented defaults (`cli` and `core`) when explicitly requested by the caller.

## Error Handling and Security

- Unknown modes, empty language selections, malformed ranges, and invalid
  language names fail before package installation.
- Existing checksum and retry behavior for downloaded toolchains is retained.
- WebUI output is inserted with `textContent`; job artifacts are untrusted.
- Nginx proxy headers and timeouts follow the existing deployment defaults.
- WebUI installation is atomic: copy to a temporary directory, validate
  `index.html`, then rename into place.  A failed copy leaves the previous
  installation intact.
- Uninstall removes the WebUI root and Nginx site only when those paths were
  created by Sandkasten, while preserving user data unless purge is chosen.

## Testing and Acceptance

- Shell tests verify mode parsing, language parsing, non-interactive behavior,
  and that CLI mode does not emit a WebUI Nginx location.
- WebUI tests verify required files, safe output rendering primitives, and
  the API request paths using a small Node test harness.
- Existing Go/Rust tests and `./werkzeug/test.sh` remain green.
- A dry-run installer invocation demonstrates both mode branches without
  requiring root or package downloads.
- Documentation includes the one-liner, mode examples, language selection
  syntax, layout, and uninstall behavior.
