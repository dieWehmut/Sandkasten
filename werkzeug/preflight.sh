#!/usr/bin/env bash
set -Eeuo pipefail

failures=0
warnings=0

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  failures=$((failures + 1))
}

warn() {
  printf 'WARN: %s\n' "$1" >&2
  warnings=$((warnings + 1))
}

pass() {
  printf 'OK: %s\n' "$1"
}

need_cmd() {
  local name="$1"
  local hint="$2"
  if command -v "$name" >/dev/null 2>&1; then
    pass "$name is available"
  else
    warn "missing $name; $hint"
  fi
}

need_env_u64() {
  local name="$1"
  local min="$2"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    fail "$name is not set"
    return
  fi
  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    fail "$name must be an unsigned integer, got: $value"
    return
  fi
  if (( value < min )); then
    fail "$name must be >= $min, got: $value"
    return
  fi
  pass "$name=$value"
}

need_env_u64_max() {
  local name="$1"
  local max="$2"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    fail "$name is not set"
    return
  fi
  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    fail "$name must be an unsigned integer, got: $value"
    return
  fi
  if (( value == 0 || value > max )); then
    fail "$name must be between 1 and $max, got: $value"
    return
  fi
  pass "$name=$value"
}

if [[ "$(uname -s)" != "Linux" ]]; then
  fail "runner preflight requires Linux"
else
  pass "Linux host detected"
fi

if [[ -r /proc/self/status ]]; then
  pass "/proc is readable"
  if grep -q '^Seccomp:[[:space:]]*[12]' /proc/self/status; then
    pass "seccomp is active for this process"
  else
    warn "seccomp is not active for this process; verify kernel seccomp support before running untrusted code"
  fi
else
  fail "/proc/self/status is not readable"
fi

if mountpoint -q /sys/fs/cgroup 2>/dev/null; then
  pass "/sys/fs/cgroup is mounted"
  if [[ -r /sys/fs/cgroup/cgroup.controllers ]]; then
    pass "cgroup v2 unified hierarchy detected"
    controllers="$(cat /sys/fs/cgroup/cgroup.controllers)"
    for controller in cpu memory pids; do
      if grep -qw "$controller" <<<"$controllers"; then
        pass "cgroup controller available: $controller"
      else
        fail "required cgroup controller missing: $controller"
      fi
    done
    cgroup_root="${LAEUFER_CGROUP_ROOT:-/sys/fs/cgroup}"
    if [[ -w "$cgroup_root" ]]; then
      pass "$cgroup_root is writable"
    else
      fail "$cgroup_root is not writable; runner cannot create per-command cgroups"
    fi
  else
    fail "cgroup v2 controller file not found"
  fi
else
  fail "/sys/fs/cgroup is not mounted"
fi

if [[ -r /proc/sys/kernel/unprivileged_userns_clone ]]; then
  value="$(cat /proc/sys/kernel/unprivileged_userns_clone)"
  if [[ "$value" == "1" ]]; then
    pass "unprivileged user namespaces are enabled"
  else
    warn "unprivileged user namespaces are disabled; privileged runner pods may still work, but local non-root preflight will not"
  fi
else
  warn "cannot read kernel.unprivileged_userns_clone; verify namespace policy manually"
fi

if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
  pass "running as root"
else
  warn "not running as root; Kubernetes runner pods are expected to run privileged on dedicated nodes"
fi

need_cmd unshare "install util-linux to test namespace support locally"
need_cmd ip "install iproute2 if the sandbox config needs network namespace inspection"
need_cmd findmnt "install util-linux for mount diagnostics"

: "${LAEUFER_PIDS_MAX:=64}"
: "${LAEUFER_RLIMIT_NPROC:=64}"
: "${LAEUFER_RLIMIT_NOFILE:=1024}"
: "${LAEUFER_MEMORY_SWAP_MAX_BYTES:=0}"

need_env_u64_max LAEUFER_PIDS_MAX 256
need_env_u64_max LAEUFER_RLIMIT_NPROC 256
if [[ -n "${LAEUFER_RLIMIT_CPU_SECONDS:-}" ]]; then
  need_env_u64 LAEUFER_RLIMIT_CPU_SECONDS 1
  warn "LAEUFER_RLIMIT_CPU_SECONDS overrides per-command CPU budgets; unset it for mixed-language runners"
else
  pass "unset LAEUFER_RLIMIT_CPU_SECONDS lets the runner derive RLIMIT_CPU from each job budget"
fi
need_env_u64 LAEUFER_RLIMIT_NOFILE 64
if [[ "$LAEUFER_MEMORY_SWAP_MAX_BYTES" == "0" ]]; then
  pass "memory.swap.max will be disabled"
else
  warn "memory.swap.max is set to $LAEUFER_MEMORY_SWAP_MAX_BYTES; production runners should normally use 0"
fi

if command -v unshare >/dev/null 2>&1; then
  if unshare --user --map-root-user true >/dev/null 2>&1; then
    pass "user namespace smoke test succeeded"
  else
    warn "user namespace smoke test failed; this may be expected without privileges or with restrictive sysctls"
  fi
fi

if [[ -n "${DATABASE_URL:-}" ]]; then
  if command -v psql >/dev/null 2>&1; then
    if psql "$DATABASE_URL" -c 'select 1' >/dev/null 2>&1; then
      pass "DATABASE_URL is reachable"
    else
      fail "DATABASE_URL is set but psql could not connect"
    fi
  else
    warn "DATABASE_URL is set but psql is missing; install postgresql-client to test database connectivity"
  fi
else
  warn "DATABASE_URL is not set; runner and API need it at runtime"
fi

printf 'preflight complete: %d failure(s), %d warning(s)\n' "$failures" "$warnings"
if [[ "$failures" -gt 0 ]]; then
  exit 1
fi
