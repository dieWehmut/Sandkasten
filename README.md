# Sandkasten

Sandkasten is a self-hosted code execution system. The v1 implementation focuses on complete Go projects:

- `schnittstelle/`: Go gRPC API service.
- `laeufer/`: Rust runner and Linux sandbox controller.
- `vertrag/`: protobuf contracts shared by Go and Rust.
- `speicher/`: Postgres schema and migrations.
- `wurzelwerk/`: rootfs and runtime assets used by the runner.
- `einsatz/`: deployment manifests.
- `pruefung/`: integration and security tests.
- `beispiele/`: example clients and Go projects.
- `werkzeug/`: developer tools.
- `handbuch/`: architecture and operations documentation.

## v1 Contract

Clients upload a `tar.gz` archive containing a full Go module. The project must include `go.mod` and a `vendor/` directory. Sandkasten stores the job in Postgres, a Rust runner leases it asynchronously, then compiles and runs it inside a Linux sandbox with cgroup, namespace, filesystem, and network restrictions.

The runner does not silently fall back to Docker or ordinary host execution. If required kernel or permission features are missing, it fails preflight and refuses to execute jobs.

## Local Notes

This repository can be edited in the current environment, but the current shell does not provide local `go`, `rustc`, `cargo`, `buf`, or `protoc` binaries. Use the Dockerfiles or install those tools before running full builds.
