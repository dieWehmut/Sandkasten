# Sandkasten

Sandkasten is a self-hosted code execution system. The v1 implementation runs Go, Assembly, Bash/Shell, C, Cangjie, Clojure, CSS, C++, C#, Coq, Crystal, Dart, Elixir, Erlang, F#, Fortran, GDScript, Gleam, GNU Octave, Graphviz DOT, Haskell, HTML, Java, JavaScript, Julia, Kotlin, LaTeX, Lean4, Lua, Markdown/Mermaid, MDX, Mojo, Next.js, Nextflow, Nim, OCaml, Pascal, Perl, PHP, Prolog, Python, QML, R, Racket, Ruby, Rust, Scala, SCSS, SQL, Swift, Tailwind CSS, TypeScript, TSX/React, Typst, V, Vue 3, WDL, and Zig jobs:

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

Clients upload a `tar.gz` archive or submit single-file source through the HTTP API. Go archives must include `go.mod` and a `vendor/` directory; non-Go runtimes use language-specific entrypoints such as `main.sh`, `main.f90`, `main.md`, `main.dot`, `index.html`, `app/page.tsx`, `main.py`, `main.tex`, `main.vue`, or `main.zig`. Frontend and document runtimes emit source, compiled CSS, static HTML, or SVG to stdout; clients should treat HTML/SVG output as untrusted preview content. Sandkasten stores the job in Postgres, a Rust runner leases it asynchronously, then compiles and runs it inside a Linux sandbox with cgroup, namespace, filesystem, and network restrictions.

The runner does not silently fall back to Docker or ordinary host execution. If required kernel or permission features are missing, it fails preflight and refuses to execute jobs.

## Local Notes

Run unit tests with `./werkzeug/test.sh`. Run the Go smoke with `./werkzeug/smoke-go.sh` and the language smoke with `./werkzeug/smoke-languages.sh` after Postgres and the required toolchains are available. Set `SMOKE_LANGUAGES=ocaml` or `SMOKE_LANGUAGES="markdown graphviz"` to verify a subset.
