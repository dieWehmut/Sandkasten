# Sandkasten

Sandkasten is a self-hosted code execution system. The v1 implementation runs Go, Bash/Shell, C, Cangjie, Clojure, C++, C#, Coq, Dart, Elixir, Java, JavaScript, Julia, Kotlin, Lean4, Lua, Nim, Perl, PHP, Prolog, Python, R, Racket, Ruby, Rust, Scala, SQL, Swift, TypeScript, and Zig jobs:

- `schnittstelle/`: Go gRPC API service.
- `laeufer/`: Rust runner and Linux sandbox controller.
- `vertrag/`: protobuf contracts shared by Go and Rust.
- `speicher/`: Postgres schema and migrations.
- `wurzelwerk/`: rootfs and runtime assets used by the runner.
- `einsatz/`: deployment manifests.
- `pruefung/`: integration and security tests.
- `beispiele/`: example clients and projects.
- `werkzeug/`: developer tools.
- `handbuch/`: architecture and operations documentation.

## v1 Contract

Clients upload a `tar.gz` archive or submit single-file source through the HTTP API. Go archives must include `go.mod` and a `vendor/` directory; non-Go runtimes use language-specific single-file entrypoints such as `main.sh`, `main.cj`, `main.py`, `main.rkt`, `main.swift`, or `main.zig`. Sandkasten stores the job in Postgres, a Rust runner leases it asynchronously, then compiles and runs it inside a Linux sandbox with cgroup, namespace, filesystem, and network restrictions.

The runner does not silently fall back to Docker or ordinary host execution. If required kernel or permission features are missing, it fails preflight and refuses to execute jobs.

## Local Notes

Run unit tests with `./werkzeug/test.sh`. Run the Go smoke with `./werkzeug/smoke-go.sh` and the full language smoke with `./werkzeug/smoke-languages.sh` after Postgres and the required toolchains are available.
