<h1 align="center">Sandkasten</h1>

<p align="center">Self-hosted multi-language online code execution sandbox</p>

<div align="center">

<div>
<a href="https://run.diesw.tech/v1/runtimes" target="_blank">
  <img src="https://img.shields.io/badge/DEMO-Runtimes-1FC41F?style=flat-square&logo=googlechrome&logoColor=white&labelColor=555555" alt="Demo">
</a>
<a href="https://github.com/dieWehmut/sandkasten" target="_blank">
  <img src="https://img.shields.io/badge/Languages-58-F9D553?style=flat-square&logo=codeigniter&logoColor=white&labelColor=555555" alt="Languages">
</a>
</div>

<div>
<a href="https://go.dev/" target="_blank">
  <img src="https://img.shields.io/badge/API-Go%201.25%2B-00ADD8?style=flat-square&logo=go&logoColor=white&labelColor=555555" alt="Go">
</a>
<a href="https://www.rust-lang.org/" target="_blank">
  <img src="https://img.shields.io/badge/Runner-Rust-DEA584?style=flat-square&logo=rust&logoColor=white&labelColor=555555" alt="Rust">
</a>
<a href="https://www.postgresql.org/" target="_blank">
  <img src="https://img.shields.io/badge/Store-PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white&labelColor=555555" alt="PostgreSQL">
</a>
<a href="https://www.linux.org/" target="_blank">
  <img src="https://img.shields.io/badge/Sandbox-Linux-FCC624?style=flat-square&logo=linux&logoColor=black&labelColor=555555" alt="Linux">
</a>
</div>

</div>

<div align="center">

[简体中文](../README.md) | [繁體中文](README.zh-TW.md) | English | [日本語](README.ja.md)

</div>

---

`Sandkasten` is a self-hosted online code execution system. Clients submit single-file source or a `tar.gz` archive over the HTTP API; the server persists the job in Postgres, a Rust runner (`laeufer`) leases it asynchronously, then compiles and runs it inside a Linux sandbox with cgroup, namespace, filesystem and network isolation. v1 supports **58 languages and runtimes**. It works as a "run code online" backend for a blog/docs site, or as a standalone judging/demo service.

The runner does **not** silently fall back to Docker or ordinary host execution; if the required kernel or permission features are missing, it fails preflight and refuses to run jobs.

## Demo

- Runtime index page: <https://run.diesw.tech/v1/runtimes>
- Frontend example: <https://diewehmut.github.io/>

The runtime index page is server-rendered by the API and lists every enabled language, its version, default resource limits, and compile/run commands.

## Features

- 58 languages and runtimes, installable à la carte (no need to install them all)
- Two submission modes: single-file source or `tar.gz` archive
- Rust runner + Linux sandbox: cgroup v2 quotas, namespace isolation, no network, read-only root filesystem
- Per-language default/maximum resources (timeout, memory, CPU, output size)
- Server-rendered runtime index page with official language icons
- Both HTTP and gRPC interfaces
- Frontend/document runtimes (HTML, Markdown, Mermaid, Graphviz, Typst, LaTeX, Vue, TSX, …) emit previewable artifacts
- Interactive one-shot deploy script: pick languages, build, systemd auto-start on boot, Nginx reverse proxy + Let's Encrypt HTTPS
- Companion uninstaller with thorough cleanup and a residual self-check

## Architecture

| Directory | Purpose |
| --- | --- |
| `schnittstelle/` | Go gRPC / HTTP API service |
| `laeufer/` | Rust runner and Linux sandbox controller |
| `vertrag/` | protobuf contracts shared by Go and Rust |
| `speicher/` | Postgres schema and migrations |
| `wurzelwerk/` | rootfs and runtime assets used by the runner |
| `einsatz/` | deployment manifests (Docker / K8s) |
| `pruefung/` | integration and security tests |
| `beispiele/` | example clients and projects |
| `werkzeug/` | developer and deployment scripts |
| `handbuch/` | architecture & operations docs (and this README's translations) |

## Quick Start

### One-line install, no clone (recommended)

On a Debian / Ubuntu (x86_64) host, run a single command as root (the script installs git and clones the source to `/opt/sandkasten/src` automatically):

```bash
curl -fsSL https://cdn.jsdelivr.net/gh/dieWehmut/sandkasten@main/werkzeug/install.sh -o sandkasten-install.sh && chmod +x sandkasten-install.sh && sudo ./sandkasten-install.sh
```

Or clone first, then run:

```bash
git clone https://github.com/dieWehmut/sandkasten.git
cd sandkasten
sudo ./werkzeug/deploy.sh
```

The installer is interactive and first asks for a deployment mode (`cli` or
`webui`), then walks you through:

1. **Show server configuration** (CPU / memory / disk) and estimate the disk footprint of your selection
2. **Pick languages by number** — a numbered menu of 58 runtimes; enter numbers (e.g. `1 5 12`), ranges (`1-10`), language names, or presets `core` / `web` / `all`; only the chosen toolchains are installed
3. **Provision PostgreSQL** (role / database / schema)
4. **Build** the `sandkasten-api` (Go) and `laeufer` (Rust) binaries
5. **Write env files**, install systemd units, and **enable auto-start on boot**
6. Optional: **Nginx reverse proxy + Let's Encrypt HTTPS**, with automatic CORS update

Non-interactive options and subcommands are also available:

```bash
sudo ./werkzeug/install.sh --mode cli --languages core --non-interactive
sudo ./werkzeug/install.sh --mode webui --languages python,typescript --non-interactive
sudo ./werkzeug/install.sh --dry-run --mode webui --languages web
sudo ./werkzeug/install.sh status
sudo ./werkzeug/install.sh languages   # reselect languages and hot-update
sudo ./werkzeug/install.sh domain      # configure domain / Nginx / HTTPS only
```

`--languages` accepts comma- or space-separated names, one-based menu numbers,
ranges, and the `core`, `web`, and `all` presets. `--dry-run` only prints the
parsed mode, languages, and command. `deploy.sh` remains a compatibility
wrapper for existing invocations.

In `webui` mode, Nginx serves the dependency-free `webui/` directory from
`/opt/sandkasten/webui` (override with `SANDKASTEN_WEBUI_DIR`) and proxies
`/v1/` and `/healthz` to the API. The browser client consequently uses
same-origin relative URLs. CLI mode installs the backend without this static
site.

### Local dev stack

Start only Postgres and load the schema (requires Docker):

```bash
./werkzeug/dev-up.sh
```

## Uninstall

One-line uninstall, no clone:

```bash
curl -fsSL https://cdn.jsdelivr.net/gh/dieWehmut/sandkasten@main/werkzeug/uninstall.sh -o sk-uninstall.sh && chmod +x sk-uninstall.sh && sudo ./sk-uninstall.sh --purge
```

Or from within the repo:

```bash
sudo ./werkzeug/uninstall.sh              # interactive, per-step confirmation
sudo ./werkzeug/uninstall.sh --dry-run    # preview only, no deletions
sudo ./werkzeug/uninstall.sh --purge      # one-shot full removal (still confirms once)
```

The installer also exposes `sudo ./werkzeug/install.sh uninstall`. Both
uninstallers support interactive confirmation, `--dry-run`, and `--purge`;
purge removes managed WebUI files and the Nginx site in addition to services,
state, database objects, and managed toolchains.

The uninstaller removes, in lock-step with the deployer: systemd services, binaries, `/etc/sandkasten` config, `/var/lib/sandkasten` state, the database and role, language toolchains under `/opt` and their `/usr/local/bin` symlinks, global npm packages, `/usr/local/go`, build caches, the Nginx site and certificate, and the service account — finishing with a **residual self-check**. System apt language packages are kept by default (they may be shared by the rest of the system).

## API

The API serves both HTTP and gRPC. Main HTTP routes:

| Method & path | Purpose |
| --- | --- |
| `GET /v1/runtimes` | List runtimes (HTML index page for browsers, JSON otherwise) |
| `POST /v1/run` | Submit a job (generic) |
| `POST /v1/{language}/run` | Submit a job for a specific language |
| `GET /v1/jobs/{job_id}` | Query job status and result |
| `GET /healthz` | Health check |

**v1 contract**: clients upload a `tar.gz` archive or submit single-file source. Go archives must include `go.mod` and a `vendor/` directory; non-Go runtimes use their own entrypoints such as `main.sh`, `main.f90`, `main.md`, `main.dot`, `index.html`, `app/page.tsx`, `main.py`, `main.tex`, `main.vue`, `main.zig`, etc. Frontend and document runtimes emit source, compiled CSS, static HTML, or SVG to stdout; clients should treat HTML/SVG output as **untrusted** preview content.

See `api.md`, `architecture.md`, `deployment.md` and `runner-security.md` in this folder for details.

## Supported Languages

Go, Assembly, Bash/Shell, C, Cangjie, Clojure, CSS, C++, C#, Coq, Crystal, Dart, Elixir, Erlang, F#, Fortran, GDScript, Gleam, GNU Octave, Graphviz DOT, Haskell, HTML, Java, JavaScript, Julia, Kotlin, LaTeX, Lean4, Lua, Markdown/Mermaid, MDX, Mojo, Next.js, Nextflow, Nim, OCaml, Pascal, Perl, PHP, Prolog, Python, QML, R, Racket, Ruby, Rust, Scala, SCSS, SQL, Swift, Tailwind CSS, TypeScript, TSX/React, Typst, V, Vue 3, WDL, Zig.

## Local Testing

```bash
./werkzeug/test.sh                 # unit tests
./werkzeug/smoke-go.sh             # local API + runner Go execution smoke
./werkzeug/smoke-languages.sh      # HTTP smoke for all languages
```

Set `SMOKE_LANGUAGES=ocaml` or `SMOKE_LANGUAGES="markdown graphviz"` to verify a subset.

## License

This repository does not yet ship a standalone LICENSE file; please confirm the terms with the repository owner before using it in production or redistribution.
