# Architecture

Sandkasten v1 is a self-hosted code execution system for Go, Bash/Shell, C, Cangjie, C++, C#, Coq, Elixir, Java, JavaScript, Julia, Kotlin, Lean4, Lua, Nim, Perl, PHP, Prolog, Python, R, Racket, Ruby, Rust, Scala, SQL, Swift, TypeScript, and Zig jobs.
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

Postgres is the v1 coordination point. The API writes jobs and serves reads. Runner processes lease jobs asynchronously, renew leases while executing, and update status, artifacts, terminal errors, and attempt diagnostics only while they still hold the recorded runner id, exact `attempt_id`, and current attempt number. Each lease increments `attempt_count`; expired active jobs that reach `LAEUFER_MAX_ATTEMPTS` are moved to `SYSTEM_ERROR` instead of being retried indefinitely. `LISTEN/NOTIFY` wakes runners for queued jobs and wakes job event streams/cancel watchers for status changes; timed polling remains the fallback and database state remains authoritative. There is no queue service in v1; queue semantics are encoded in the `jobs` table.

## Runtime Contract

Go jobs must provide:

- `go.mod`.
- `vendor/` directory.
- An entrypoint path, defaulting to `.`.

The non-Go runtime contract is single-file source with language-specific default entrypoints: `main.sh`, `main.c`, `main.cj`, `main.cpp`, `Program.cs`, `main.v`, `main.exs`, `Main.java`, `main.js`, `main.jl`, `Main.kt`, `Main.lean`, `main.lua`, `main.nim`, `main.pl`, `main.php`, `main.py`, `main.R`, `main.rkt`, `main.rb`, `main.rs`, `Main.scala`, `main.sql`, `main.swift`, `main.ts`, and `main.zig`.

The runner must not fetch dependencies from the network. Runtime images/rootfs assets assume vendored Go builds, system toolchains for non-Go languages, and restricted networking. When `LAEUFER_ROOTFS` is configured, child commands execute after a `pivot_root` into that rootfs with the job directory mounted at `/workspace`, private `/tmp`, read-only `/proc` with expanded sensitive proc-file masks and empty read-only proc-directory masks, and a minimal `/dev`.

## Security Boundary

The API is an ordinary network service. The runner is the high-risk component and must run only on dedicated, tainted nodes. It needs privileged Linux access for namespaces, cgroups, mounts, rootfs setup, and child seccomp installation. Sandkasten v1 deliberately avoids fallback execution on Docker or unsandboxed host execution when sandbox preflight fails.
