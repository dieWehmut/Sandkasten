#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
failures=0

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  failures=$((failures + 1))
}

require_file_contains() {
  local file="$1"
  local pattern="$2"
  if ! grep -Fq "$pattern" "$ROOT/$file"; then
    fail "$file missing: $pattern"
  fi
}

require_file_contains "einsatz/k8s/01-config.yaml" 'LAEUFER_RLIMIT_CPU_SECONDS: "2"'
require_file_contains "einsatz/docker-compose.dev.yaml" 'LAEUFER_RLIMIT_CPU_SECONDS: "2"'
require_file_contains "einsatz/k8s/06-laeufer.yaml" 'cpu: "2"'
require_file_contains "einsatz/k8s/06-laeufer.yaml" 'ephemeral-storage: 8Gi'
require_file_contains "Makefile" 'docker-clean'
require_file_contains "werkzeug/preflight.sh" 'LAEUFER_RLIMIT_CPU_SECONDS'
require_file_contains "werkzeug/preflight.sh" 'LAEUFER_PIDS_MAX'
require_file_contains "werkzeug/preflight.sh" 'memory.swap.max'

if [[ "$failures" -gt 0 ]]; then
  exit 1
fi

printf 'security config check complete\n'
