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

assert_executable() {
  local file="$1"
  local relative="${file#"$ROOT/"}"
  if git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
    git -C "$ROOT" ls-files --stage -- "$relative" | grep -q '^100755 ' ||
      fail "file is not executable in Git: $relative"
  else
    [[ -x "$file" ]] || fail "file is not executable: $relative"
  fi
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
  "$ROOT/werkzeug/quality/lint.sh" \
  "$ROOT/werkzeug/security/preflight.sh" \
  "$ROOT/werkzeug/security/check-security-config.sh" \
  "$ROOT/werkzeug/security/security-tests.sh" \
  "$ROOT/werkzeug/smoke/smoke-go.sh" \
  "$ROOT/werkzeug/smoke/smoke-languages.sh" \
  "$ROOT/werkzeug/smoke/smoke-concurrency.mjs"; do
  assert_file "$script"
  assert_executable "$script"
done

for wrapper in \
  dev-up.sh \
  gen-proto.sh \
  docker-clean.sh \
  test.sh \
  lint.sh \
  preflight.sh \
  check-security-config.sh \
  security-tests.sh \
  smoke-go.sh \
  smoke-languages.sh \
  smoke-concurrency.mjs; do
  assert_file "$ROOT/werkzeug/$wrapper"
  assert_executable "$ROOT/werkzeug/$wrapper"
done

for wrapper in \
  dev-up.sh \
  gen-proto.sh \
  docker-clean.sh \
  test.sh \
  lint.sh \
  preflight.sh \
  check-security-config.sh \
  security-tests.sh \
  smoke-go.sh \
  smoke-languages.sh; do
  assert_contains "$ROOT/werkzeug/$wrapper" 'exec bash'
done

assert_wrapper_target dev-up.sh development/dev-up.sh
assert_wrapper_target gen-proto.sh development/gen-proto.sh
assert_wrapper_target docker-clean.sh development/docker-clean.sh
assert_wrapper_target test.sh quality/test.sh
assert_wrapper_target lint.sh quality/lint.sh
assert_wrapper_target preflight.sh security/preflight.sh
assert_wrapper_target check-security-config.sh security/check-security-config.sh
assert_wrapper_target security-tests.sh security/security-tests.sh
assert_wrapper_target smoke-go.sh smoke/smoke-go.sh
assert_wrapper_target smoke-languages.sh smoke/smoke-languages.sh
assert_contains "$ROOT/werkzeug/smoke-concurrency.mjs" "import './smoke/smoke-concurrency.mjs'"

for target in \
  './werkzeug/development/dev-up.sh' \
  './werkzeug/development/gen-proto.sh' \
  './werkzeug/development/docker-clean.sh' \
  './werkzeug/quality/test.sh' \
  './werkzeug/quality/lint.sh' \
  './werkzeug/security/preflight.sh' \
  './werkzeug/smoke/smoke-go.sh' \
  './werkzeug/smoke/smoke-languages.sh'; do
  assert_contains "$ROOT/Makefile" "$target"
done

assert_contains "$ROOT/werkzeug/development/dev-up.sh" 'dirname "${BASH_SOURCE[0]}")/../..'
assert_contains "$ROOT/werkzeug/development/gen-proto.sh" 'dirname "${BASH_SOURCE[0]}")/../..'
assert_contains "$ROOT/werkzeug/quality/test.sh" 'dirname "${BASH_SOURCE[0]}")/../..'
assert_contains "$ROOT/werkzeug/quality/lint.sh" 'dirname "${BASH_SOURCE[0]}")/../..'
assert_contains "$ROOT/werkzeug/quality/lint.sh" 'find "$ROOT/werkzeug" -type f -name '\''*.sh'\'' -print0'
assert_contains "$ROOT/werkzeug/security/check-security-config.sh" 'dirname "${BASH_SOURCE[0]}")/../..'
assert_contains "$ROOT/werkzeug/security/security-tests.sh" 'dirname "${BASH_SOURCE[0]}")/../..'
assert_contains "$ROOT/werkzeug/smoke/smoke-go.sh" 'dirname "${BASH_SOURCE[0]}")/../..'
assert_contains "$ROOT/werkzeug/smoke/smoke-languages.sh" 'dirname "${BASH_SOURCE[0]}")/../..'
assert_contains "$ROOT/werkzeug/security/check-security-config.sh" 'werkzeug/security/preflight.sh'
assert_contains "$ROOT/werkzeug/quality/lint.sh" 'werkzeug/security/check-security-config.sh'

printf 'script layout tests: ok\n'
