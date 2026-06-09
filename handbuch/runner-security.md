# Runner Security

The `laeufer` runner executes untrusted user code. Treat runner nodes as dedicated execution hosts, not general application nodes.

## Implemented v1 Controls

The current runner implementation applies these controls for each child command:

- Dedicated Kubernetes nodes labeled `sandkasten.dev/runner=true`.
- A matching taint so ordinary workloads are not scheduled on runner nodes.
- Privileged runner pods only on those nodes.
- Per-command cgroup v2 limits for CPU, memory, process count, and output.
- `unshare` via libc for mount, IPC, UTS, and network namespaces.
- Private mount propagation for the child mount namespace.
- `PR_SET_NO_NEW_PRIVS` and uid/gid drop to `65534`.
- Go builds forced through `-mod=vendor` with per-job `GOCACHE` and temp directories.
- Language-specific compile/run plans for C, C++, C#, Java, JavaScript, Python, Rust, and TypeScript.
- A separate `LAEUFER_COMPILE_MEMORY_LIMIT_BYTES` setting for compilation, while job memory limits still apply to the executed program.
- No fallback to Docker or unsandboxed host execution.

## Hardening Backlog

These are intentionally represented in the repository but are not complete enforcement yet:

- `pivot_root` into a minimal rootfs from `wurzelwerk/`.
- PID namespace supervision with a reaper process.
- User namespace uid/gid mapping.
- A production seccomp BPF profile installed by the runner rather than only shipped as an asset.

## Node Scheduling

Prepare runner nodes with:

```sh
kubectl label node <node> sandkasten.dev/runner=true
kubectl taint node <node> sandkasten.dev/runner=true:NoSchedule
```

The provided DaemonSet in `einsatz/k8s/06-laeufer.yaml` selects only those nodes and tolerates only that taint.

## Privileged Pod Scope

The runner pod is privileged because the runner must configure kernel isolation features for child processes. Keep that privilege away from the API and database. The API manifest drops all Linux capabilities and runs as non-root.

## Rootfs and Network

The runner image includes system toolchains for the supported languages. Go jobs are required to ship a `vendor/` directory and compile with `-mod=vendor`; first-pass non-Go jobs are single-file source programs. The child process gets a private network namespace by default; do not disable `LAEUFER_REQUIRE_PRIVATE_NAMESPACES` on production runner nodes.

## Seccomp Placeholder

`wurzelwerk/go/seccomp/go-conservative-placeholder.json` is a starting point, not an audited production profile and not yet installed by the Rust runner. Use it to define the shape of the runner integration, then tighten it against real syscall traces from representative compile and run workloads.

## Operational Rules

- Rotate API tokens and database credentials through Kubernetes Secrets.
- Keep runner nodes patched and disposable.
- Do not co-locate unrelated stateful services with runner pods.
- Store no long-lived credentials inside rootfs images.
- Fail preflight when required kernel features are missing.
