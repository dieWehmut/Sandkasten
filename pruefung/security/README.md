# Security Tests

This directory is reserved for runner security checks such as:

- preflight failure on missing namespace or cgroup capabilities.
- denied network access from job processes.
- memory and output limit enforcement.
- seccomp profile smoke tests against `wurzelwerk/go/seccomp/`.
