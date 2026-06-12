#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="/usr/local/go/bin:$PATH:/usr/local/bin:/usr/bin:/bin"
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

if command -v shellcheck >/dev/null 2>&1; then
  run_or_fail "shellcheck" shellcheck "$ROOT"/werkzeug/*.sh
else
  printf 'shellcheck not found; using bash -n for script syntax only\n' >&2
  for script in "$ROOT"/werkzeug/*.sh; do
    run_or_fail "bash syntax $(basename "$script")" bash -n "$script"
  done
fi

run_or_fail "security config check" "$ROOT/werkzeug/check-security-config.sh"

if [[ -f "$ROOT/vertrag/buf.yaml" ]]; then
  if command -v buf >/dev/null 2>&1; then
    run_or_fail "buf lint" bash -c "cd \"\$1\" && buf lint" bash "$ROOT/vertrag"
  else
    missing buf "Install buf to lint protobuf contracts."
  fi
fi

if [[ -f "$ROOT/schnittstelle/go.mod" ]]; then
  if command -v go >/dev/null 2>&1; then
    run_or_fail "go fmt check" bash -c "cd \"\$1\" && test -z \"\$(gofmt -l .)\"" bash "$ROOT/schnittstelle"
    run_or_fail "go vet" bash -c "cd \"\$1\" && go vet ./..." bash "$ROOT/schnittstelle"
  else
    missing go "Install Go 1.25+ to format and vet the API."
  fi
fi

if [[ -f "$ROOT/laeufer/Cargo.toml" ]]; then
  if command -v cargo >/dev/null 2>&1; then
    run_or_fail "cargo fmt check" bash -c "cd \"\$1\" && cargo fmt --all -- --check" bash "$ROOT/laeufer"
    run_or_fail "cargo clippy" bash -c "cd \"\$1\" && cargo clippy --all-targets --all-features -- -D warnings" bash "$ROOT/laeufer"
  else
    missing cargo "Install the Rust toolchain to format and lint the runner."
  fi
fi

if [[ "$failures" -gt 0 ]]; then
  printf 'lint run finished with %d failure(s)\n' "$failures" >&2
  exit 1
fi

printf 'lint run complete\n'
