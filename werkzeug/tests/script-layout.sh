#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

fail() {
  printf 'script layout test failed: %s\n' "$1" >&2
  exit 1
}

assert_file() {
  [[ -f "$1" ]] || fail "missing file: ${1#"$ROOT/"}"
}

assert_contains() {
  local file="$1"
  local expected="$2"
  grep -Fq -- "$expected" "$file" || fail "missing '$expected' in ${file#"$ROOT/"}"
}

assert_wrapper_target() {
  local wrapper="$1"
  local target="$2"
  assert_contains "$ROOT/werkzeug/$wrapper" "exec bash \"\$SCRIPT_DIR/$target\" \"\$@\""
}

for script in \
  "$ROOT/werkzeug/development/dev-up.sh" \
  "$ROOT/werkzeug/development/gen-proto.sh" \
  "$ROOT/werkzeug/development/docker-clean.sh" \
  "$ROOT/werkzeug/quality/test.sh" \
  "$ROOT/werkzeug/quality/lint.sh"; do
  assert_file "$script"
done

for wrapper in dev-up.sh gen-proto.sh docker-clean.sh test.sh lint.sh; do
  assert_file "$ROOT/werkzeug/$wrapper"
  assert_contains "$ROOT/werkzeug/$wrapper" 'exec bash'
done

assert_wrapper_target dev-up.sh development/dev-up.sh
assert_wrapper_target gen-proto.sh development/gen-proto.sh
assert_wrapper_target docker-clean.sh development/docker-clean.sh
assert_wrapper_target test.sh quality/test.sh
assert_wrapper_target lint.sh quality/lint.sh

for target in \
  './werkzeug/development/dev-up.sh' \
  './werkzeug/development/gen-proto.sh' \
  './werkzeug/development/docker-clean.sh' \
  './werkzeug/quality/test.sh' \
  './werkzeug/quality/lint.sh'; do
  assert_contains "$ROOT/Makefile" "$target"
done

assert_contains "$ROOT/werkzeug/development/dev-up.sh" 'dirname "${BASH_SOURCE[0]}")/../..'
assert_contains "$ROOT/werkzeug/development/gen-proto.sh" 'dirname "${BASH_SOURCE[0]}")/../..'
assert_contains "$ROOT/werkzeug/quality/test.sh" 'dirname "${BASH_SOURCE[0]}")/../..'
assert_contains "$ROOT/werkzeug/quality/lint.sh" 'dirname "${BASH_SOURCE[0]}")/../..'
assert_contains "$ROOT/werkzeug/quality/lint.sh" 'find "$ROOT/werkzeug" -type f -name '\''*.sh'\'' -print0'

printf 'script layout tests: ok\n'
