#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
failures=0

run_or_fail() {
  local label="$1"
  shift
  printf '==> %s\n' "$label"
  if ! "$@"; then
    printf 'FAILED: %s\n' "$label" >&2
    failures=$((failures + 1))
  fi
}

missing() {
  local tool="$1"
  local hint="$2"
  printf 'MISSING: %s\n%s\n' "$tool" "$hint" >&2
  failures=$((failures + 1))
}

if [[ -f "$ROOT/schnittstelle/go.mod" ]]; then
  if command -v go >/dev/null 2>&1; then
    run_or_fail "Go API tests" bash -c "cd \"\$1\" && go test ./..." bash "$ROOT/schnittstelle"
  else
    missing go "Install Go 1.25+ or run this script in the API builder image."
  fi
fi

if [[ -f "$ROOT/laeufer/Cargo.toml" ]]; then
  if command -v cargo >/dev/null 2>&1; then
    run_or_fail "Rust runner tests" bash -c "cd \"\$1\" && cargo test --all" bash "$ROOT/laeufer"
  else
    missing cargo "Install the Rust toolchain or run this script in the runner builder image."
  fi
fi

if [[ -d "$ROOT/pruefung/integration" ]]; then
  if find "$ROOT/pruefung/integration" -type f | grep -q .; then
    printf 'Integration fixtures are present under pruefung/integration; no standalone integration runner is defined yet.\n'
  fi
fi

if [[ "$failures" -gt 0 ]]; then
  printf 'test run finished with %d failure(s)\n' "$failures" >&2
  exit 1
fi

printf 'test run complete\n'
