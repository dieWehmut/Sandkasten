# Architecture

Sandkasten v1 is a self-hosted code execution system for Go, C, C++, C#, Java, JavaScript, Python, Rust, and TypeScript jobs.
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

Postgres is the v1 coordination point. The API writes jobs and serves reads. Runner processes lease jobs asynchronously and update status, artifacts, and terminal errors. There is no queue service in v1; queue semantics are encoded in the `jobs` table.

## Runtime Contract

Go jobs must provide:

- `go.mod`.
- `vendor/` directory.
- An entrypoint path, defaulting to `.`.

The first non-Go runtime contract is single-file source with language-specific default entrypoints: `main.c`, `main.cpp`, `Program.cs`, `Main.java`, `main.js`, `main.py`, `main.rs`, and `main.ts`.

The runner must not fetch dependencies from the network. Runtime images/rootfs assets assume vendored Go builds, system toolchains for non-Go languages, and restricted networking.

## Security Boundary

The API is an ordinary network service. The runner is the high-risk component and must run only on dedicated, tainted nodes. It needs privileged Linux access for namespaces, cgroups, mounts, and future rootfs/seccomp setup. Sandkasten v1 deliberately avoids fallback execution on Docker or unsandboxed host execution when sandbox preflight fails.
