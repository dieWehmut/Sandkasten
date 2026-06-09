# Seccomp Profiles

`go-conservative-placeholder.json` is a conservative placeholder for the runner integration. It defaults to `SCMP_ACT_ERRNO` and allows a small syscall set expected by simple Go compile/run workloads.

Before production use:

1. Trace representative jobs on the target kernel.
2. Add only required syscalls.
3. Keep network, module, ptrace, keyring, mount, and BPF syscalls denied unless the runtime contract changes.
4. Re-run security tests under `pruefung/security/`.
