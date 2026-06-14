# Architecture

Sandkasten v1 is a self-hosted code execution system for Go, Assembly, Bash/Shell, C, Cangjie, Clojure, CSS, C++, C#, Coq, Crystal, Dart, Elixir, Erlang, F#, Fortran, GDScript, Gleam, GNU Octave, Graphviz DOT, Haskell, HTML, Java, JavaScript, Julia, Kotlin, LaTeX, Lean4, Lua, Markdown/Mermaid, MDX, Mojo, Next.js, Nextflow, Nim, OCaml, Pascal, Perl, PHP, Prolog, Python, QML, R, Racket, Ruby, Rust, Scala, SCSS, SQL, Swift, Tailwind CSS, TypeScript, TSX/React, Typst, V, Vue 3, WDL, and Zig jobs.
The repository uses German directory names for component ownership:

- `schnittstelle/`: Go gRPC API.
- `laeufer/`: Rust runner that leases jobs and controls the Linux sandbox.
- `vertrag/`: protobuf service contracts.
- `speicher/`: Postgres schema and migrations.
- `wurzelwerk/`: runtime rootfs and sandbox assets.
- `einsatz/`: deployment manifests and container builds.
- `werkzeug/`: local developer scripts.
- `pruefung/`: fixtures and integration/security test material.
- `beispiele/`: sample projects and clients.

## v1 Flow

1. A client sends `SubmitGoProject` with a `tar.gz` archive, or uses the HTTP `/v1/{language}/run` endpoint for single-file source.
2. The API validates request shape, applies default limits, and stores the job in Postgres.
3. A `laeufer` process leases queued jobs using the database lease fields.
4. The runner validates the archive, prepares a language-specific compile/run plan, and executes it with Linux cgroup, namespace, `no_new_privs`, and uid/gid isolation.
5. Status changes and final artifacts are written to Postgres.
6. Clients call `GetJob` or `StreamJobEvents` to observe progress.

## Storage

Postgres is the v1 coordination point. The API writes jobs and serves reads. Runner processes lease jobs asynchronously, renew leases while executing, and update status, artifacts, terminal errors, and attempt diagnostics only while they still hold the recorded runner id, exact `attempt_id`, and current attempt number. Each runner keeps up to `LAEUFER_MAX_CONCURRENT_JOBS` active leases at once, so a slow compile for Zig, V, Nim, Crystal, Racket, or another heavy runtime does not block unrelated queued work on that runner. Each lease increments `attempt_count`; expired active jobs that reach `LAEUFER_MAX_ATTEMPTS` are moved to `SYSTEM_ERROR` instead of being retried indefinitely. `LISTEN/NOTIFY` wakes runners for queued jobs and wakes job event streams/cancel watchers for status changes; timed polling remains the fallback and database state remains authoritative. There is no queue service in v1; queue semantics are encoded in the `jobs` table.

## Runtime Contract

Go jobs must provide:

- `go.mod`.
- `vendor/` directory.
- An entrypoint path, defaulting to `.`.

The non-Go runtime contract is single-file source with language-specific default entrypoints: `main.s`, `main.sh`, `main.c`, `main.cj`, `main.clj`, `main.css`, `main.cpp`, `Program.cs`, `main.v`, `main.cr`, `main.dart`, `main.exs`, `main.erl`, `main.fs`, `main.f90`, `main.gd`, `src/main.gleam`, `main.m`, `main.dot`, `Main.hs`, `index.html`, `Main.java`, `main.js`, `main.jl`, `Main.kt`, `main.tex`, `Main.lean`, `main.lua`, `main.md`, `main.mdx`, `main.mojo`, `app/page.tsx`, `main.nf`, `main.nim`, `main.ml`, `main.pas`, `main.pl`, `main.php`, `main.py`, `main.qml`, `main.R`, `main.rkt`, `main.rb`, `main.rs`, `Main.scala`, `main.scss`, `main.sql`, `main.swift`, `main.ts`, `main.tsx`, `main.typ`, `main.vv`, `main.vue`, `main.wdl`, and `main.zig`.

Frontend and document runtimes produce text artifacts through stdout: HTML/CSS source, compiled SCSS/Tailwind CSS, React TSX/Vue 3 server-rendered markup, static HTML rendered from a Next.js `app/page.tsx` component, Markdown/MDX static HTML, Graphviz/Typst SVG, or a LaTeX compile marker. They use globally installed Node packages exposed through `NODE_PATH`; jobs must not fetch npm dependencies at execution time. HTML and SVG outputs are untrusted user artifacts and should be previewed only through client-side sandboxing policies.

The runner must not fetch dependencies from the network. Runtime images/rootfs assets assume vendored Go builds, system toolchains for non-Go languages, and restricted networking. When `LAEUFER_ROOTFS` is configured, child commands execute after a `pivot_root` into that rootfs with the job directory mounted at `/workspace`, private `/tmp`, read-only `/proc` with expanded sensitive proc-file masks and empty read-only proc-directory masks, and a minimal `/dev`.

## Security Boundary

The API is an ordinary network service. The runner is the high-risk component and must run only on dedicated, tainted nodes. It needs privileged Linux access for namespaces, cgroups, mounts, rootfs setup, and child seccomp installation. Sandkasten v1 deliberately avoids fallback execution on Docker or unsandboxed host execution when sandbox preflight fails.
