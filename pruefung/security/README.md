# Security Tests

Security black-box coverage lives in the Rust runner crate so it compiles with the sandbox implementation:

- `laeufer/crates/laeufer-sandbox/tests/security_blackbox.rs`

Run it explicitly on a privileged Linux runner host:

```sh
./werkzeug/security/security-tests.sh
```

The tests are marked `#[ignore]`, so normal `cargo test --all` and
`./werkzeug/quality/test.sh` compile them but do not execute privileged checks.

Security tooling now uses the canonical `werkzeug/security/` directory. The
historical root-level `werkzeug/security-tests.sh` and related script names
remain compatibility wrappers for existing automation.

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

## GitHub Pages configuration checks

The public WebUI is published at
<https://diewehmut.github.io/sandkasten/>. Its repository variable
`SANDKASTEN_API_BASE_URL` is embedded into the static artifact and is therefore
not a secret; it must contain only a public HTTPS API origin or path prefix.
Never place an API token or other credential in that variable. A separately
hosted API must enforce HTTPS and include the Pages origin
`https://diewehmut.github.io` in `SANDKASTEN_API_CORS_ORIGINS` (the `/sandkasten/`
path is not part of the origin). Same-origin Nginx WebUI deployments do not
need this cross-origin allowance.

The Pages workflow stages only `index.html`, `app.js`, `styles.css`, and the
generated `config.js`; run `bash scripts/pages-artifact-test.sh --test` when
checking the publication contract locally.
