#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
assert_eq() {
  [[ "$1" == "$2" ]] || fail "$3 (expected '$2', got '$1')"
}

# The checked-out wrapper keeps its existing sibling-entrypoint behavior.
local_output="$(bash "$ROOT_DIR/werkzeug/install.sh" --dry-run --mode cli --languages go install)"
assert_eq "$local_output" $'mode=cli\nlanguages=go\ncommand=install' "local install entrypoint"

# A copy of install.sh with no sibling modules must bootstrap from the
# configured base URL and preserve all arguments to the staged entrypoint.
fixture="$TMP_DIR/fixture"
mkdir -p "$fixture/installer" "$TMP_DIR/standalone"
cp "$ROOT_DIR/werkzeug/install.sh" "$TMP_DIR/standalone/install.sh"
cp "$ROOT_DIR/werkzeug/deploy.sh" "$fixture/deploy.sh"
cp "$ROOT_DIR/werkzeug/installer/entrypoint.sh" "$fixture/installer/entrypoint.sh"
cp "$ROOT_DIR/werkzeug/installer/lib.sh" "$fixture/installer/lib.sh"
cp "$ROOT_DIR/werkzeug/installer/languages.sh" "$fixture/installer/languages.sh"
cp "$ROOT_DIR/werkzeug/installer/webui.sh" "$fixture/installer/webui.sh"

bootstrap_output="$(
  SANDKASTEN_INSTALL_BASE_URL="file://$fixture" \
    bash "$TMP_DIR/standalone/install.sh" --dry-run --mode webui --languages python install
)"
assert_eq "$bootstrap_output" $'mode=webui\nlanguages=python\ncommand=install' "standalone bootstrap"

bootstrap_only_output="$(
  SANDKASTEN_INSTALL_BASE_URL="file://$fixture" \
    SANDKASTEN_BOOTSTRAP_TEST=1 \
    bash "$TMP_DIR/standalone/install.sh" install
)"
assert_eq "$bootstrap_only_output" 'install.sh: bootstrap complete' "bootstrap-only test hook"

printf 'installer bootstrap tests: ok\n'
