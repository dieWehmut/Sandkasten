# Security Tests

Security black-box coverage lives in the Rust runner crate so it compiles with the sandbox implementation:

- `laeufer/crates/laeufer-sandbox/tests/security_blackbox.rs`

Run it explicitly on a privileged Linux runner host:

```sh
./werkzeug/security-tests.sh
```

The tests are marked `#[ignore]`, so normal `cargo test --all` and `./werkzeug/test.sh` compile them but do not execute privileged checks.

Covered scenarios:

- denied network access from the child network namespace.
- output limit enforcement and command-group termination.
- timeout handling with descendant cleanup.
- memory cgroup OOM mapping.
- pids cgroup pressure.
- child rlimit enforcement for open-file count, file size, and optional CPU seconds.
- rootfs visibility checks, including minimal `/dev`, proc-file masks, and empty proc-directory masks, when `LAEUFER_SECURITY_ROOTFS` points at a prepared rootfs.
- seccomp denial for the built-in child BPF denylist.

Useful environment:

- `LAEUFER_SECURITY_CGROUP_ROOT`: override cgroup v2 root, defaults to `/sys/fs/cgroup`.
- `LAEUFER_SECURITY_ROOTFS`: rootfs path for the pivot-root visibility test.
