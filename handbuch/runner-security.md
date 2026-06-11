# Runner Security

The `laeufer` runner executes untrusted user code. Treat runner nodes as dedicated execution hosts, not general application nodes.

## Implemented v1 Controls

The current runner implementation applies these controls for each child command:

- Dedicated Kubernetes nodes labeled `sandkasten.dev/runner=true`.
- A matching taint so ordinary workloads are not scheduled on runner nodes.
- Privileged runner pods only on those nodes.
- Per-command cgroup v2 limits for CPU, memory, process count, and output, with `memory.oom.group=1`, configurable `pids.max`, and optional `memory.swap.max`.
- Result-level cgroup diagnostics from `memory.peak`, `memory.events oom_kill`, `cpu.stat usage_usec/throttled_usec`, and `pids.peak/current`, persisted with job artifacts and returned by the APIs.
- Per-child rlimits for optional CPU seconds, core dump size, file size, open file count, process count, stack, and memlock.
- `unshare` via libc for mount, IPC, UTS, and network namespaces.
- Private mount propagation for the child mount namespace.
- Optional `LAEUFER_ROOTFS` setup: bind the configured rootfs as the new root, bind the job directory to `/workspace`, mount private `/tmp`, read-only `/proc`, and a minimal `/dev` with only `null`, `zero`, `random`, and `urandom`, then mask sensitive proc files such as kernel symbols/messages, memory maps, module lists, scheduler/timer debug, IRQ/IO metadata, and VM/page stats with `/dev/null`, and bind empty read-only directories over `/proc/sys`, `/proc/irq`, `/proc/bus`, and related proc host-metadata directories before `pivot_root`.
- `PR_SET_NO_NEW_PRIVS` and uid/gid drop to `65534`.
- Built-in child seccomp BPF profiles installed after setup and privilege drop. Both compile and run profiles include an audit-architecture guard and errno returns for network syscalls and high-risk kernel interfaces such as `mount`, new mount API syscalls, `ptrace`, `process_vm_*`, `bpf`, `perf_event_open`, `keyctl`, module loading, `kexec`, handle-based file opens, `userfaultfd`, `clone3`, and `io_uring_*`. `clone3` returns `ENOSYS` so language runtimes can fall back to older `clone`; other denied syscalls return `EPERM`. The run profile additionally denies metadata mutation and clock-setting syscalls such as `chmod`, `chown`, xattr mutation, `clock_settime`, and `settimeofday`.
- `close_range(3, UINT_MAX, CLOSE_RANGE_UNSHARE)` before exec, with a `/proc/self/fd` fallback, so inherited runner descriptors are not exposed to user code.
- Go builds forced through `-mod=vendor` with `CGO_ENABLED=0`, `GOTOOLCHAIN=local`, `GOFLAGS=-buildvcs=false`, a shared runner Go build cache for compile-phase reuse, and per-job temp directories. The run phase does not inherit the shared `GOCACHE`.
- Language-specific compile/run plans for Bash/Shell, C, Cangjie, C++, C#, Coq, Java, JavaScript, Julia, Kotlin, Lean4, Lua, PHP, Prolog, Python, R, Racket, Ruby, Rust, Scala, SQL/SQLite, Swift, TypeScript, and Zig.
- A separate `LAEUFER_COMPILE_MEMORY_LIMIT_BYTES` setting for compilation, while job memory limits still apply to the executed program.
- Lease heartbeat during job execution, with status, renew, and final artifact writes guarded by runner id, exact `attempt_id`, and the current attempt number to prevent stale runners from overwriting results.
- A retry budget via `LAEUFER_MAX_ATTEMPTS`; each lease creates a `job_attempts` record, terminal writes copy exit/signal/cgroup counters plus `terminal_reason`, `cgroup_path`, and host `child_pid` onto the exact attempt, and expired active jobs that exhaust the budget are marked `SYSTEM_ERROR` with the latest attempt marked `DEAD_LETTER`.
- Running cancel watcher: when the API marks a job `CANCELED`, the runner terminates the active command with process-group and cgroup kill, then finalizes the exact active attempt as `CANCELED` for attempt forensics.
- Normal exit, timeout, cancellation, and output-limit termination all trigger `cgroup.kill`; when kernel `cgroup.kill` support is present, the runner waits for `cgroup.procs` to become empty before collecting artifacts or returning the terminal error.
- The runner process enables Linux child-subreaper mode and runs nonblocking `waitpid(..., WNOHANG)` cleanup for remaining cgroup member PIDs while draining the job cgroup, so orphaned descendants reparented in the host PID namespace can be reaped without stealing unrelated child waits.
- Terminal signal diagnostics map `SIGXCPU` to `TIME_LIMIT_EXCEEDED`, `SIGXFSZ` to `OUTPUT_LIMIT_EXCEEDED`, and hard `SIGSYS` seccomp failures to a readable seccomp-blocked message while preserving the existing status enum. Denylist hits that return `EPERM` surface as ordinary non-zero command failures with stderr preserved.
- No fallback to Docker or unsandboxed host execution.

## Hardening Backlog

These are intentionally represented in the repository but are not complete enforcement yet:

- PID namespace supervision with a reaper process.
- User namespace uid/gid mapping.
- Per-language seccomp refinements or OCI seccomp JSON loading, tightened against representative compile/run traces.
- Privileged CI execution for the ignored black-box matrix, plus PID namespace cleanup coverage.

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

The runner image includes system toolchains and language SDKs for the supported languages. Go jobs are required to ship a `vendor/` directory and compile with `-mod=vendor`; non-Go jobs are single-file source programs by default. The child process gets a private network namespace by default; do not disable `LAEUFER_REQUIRE_PRIVATE_NAMESPACES` on production runner nodes.

## Seccomp

The Rust runner installs conservative built-in compile/run seccomp profiles for every child command by default. The compile profile is intentionally broad enough for toolchains; the run profile adds extra denials for file metadata mutation and clock changes. Set `LAEUFER_DISABLE_SECCOMP=1` only for diagnostics on non-production runner nodes. `wurzelwerk/go/seccomp/go-conservative-placeholder.json` remains a starting point for a future OCI-style or per-language profile format; tighten those profiles against real syscall traces from representative compile and run workloads.

## Operational Rules

- Rotate API tokens and database credentials through Kubernetes Secrets.
- Keep runner nodes patched and disposable.
- Do not co-locate unrelated stateful services with runner pods.
- Store no long-lived credentials inside rootfs images.
- Fail preflight when required kernel features are missing.
