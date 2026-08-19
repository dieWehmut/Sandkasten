#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export SANDKASTEN_INSTALLER_TEST=1
# shellcheck source=/dev/null
source "$ROOT_DIR/werkzeug/installer/lib.sh"
# shellcheck source=/dev/null
source "$ROOT_DIR/werkzeug/installer/languages.sh"
# shellcheck source=/dev/null
source "$ROOT_DIR/werkzeug/installer/entrypoint.sh"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
assert_eq() {
  [[ "$1" == "$2" ]] || fail "$3 (expected '$2', got '$1')"
}
assert_status() {
  local expected="$1" actual
  shift
  set +e
  "$@" >/dev/null 2>&1
  actual=$?
  set -e
  [[ "$actual" -eq "$expected" ]] || fail "status $* (expected $expected, got $actual)"
}

assert_contains() {
  [[ "$1" == *"$2"* ]] || fail "$3 (missing '$2' in '$1')"
}

parse_mode cli
assert_eq "$INSTALL_MODE" cli "cli mode"
parse_mode webui
assert_eq "$INSTALL_MODE" webui "webui mode"
assert_status 2 parse_mode invalid

parse_languages core
assert_eq "${#SELECTED_LANGS[@]}" "${#PRESET_CORE[@]}" "core preset"
for lang in "${PRESET_CORE[@]}"; do
  [[ " ${SELECTED_LANGS[*]} " == *" $lang "* ]] || fail "core preset missing $lang"
done
parse_languages web
assert_eq "${#SELECTED_LANGS[@]}" "${#PRESET_WEB[@]}" "web preset"
for lang in "${PRESET_WEB[@]}"; do
  [[ " ${SELECTED_LANGS[*]} " == *" $lang "* ]] || fail "web preset missing $lang"
done
parse_languages all
assert_eq "${#SELECTED_LANGS[@]}" "${#LANGS[@]}" "all preset"

parse_languages '1,3-4,python'
assert_eq "${SELECTED_LANGS[*]}" "go bash c python" "numeric/range/name selection"
assert_status 2 parse_languages 'does-not-exist'
assert_status 2 parse_languages '0'
assert_status 2 parse_languages '1-999'

# parse_args must accept options in either order and normalize the selected
# language list while preserving the legacy catalog order.
parse_args --mode webui --languages '1,3-4,python' --non-interactive status
assert_eq "$INSTALL_MODE" webui "webui parse_args mode"
assert_eq "$INSTALL_LANGUAGES" "go,bash,c,python" "parse_args languages"
assert_eq "$NONINTERACTIVE" true "parse_args non-interactive"
assert_eq "$INSTALL_COMMAND" status "parse_args command"
assert_status 2 parse_args --mode desktop

parse_args --mode cli --dry-run
assert_eq "$INSTALL_MODE" cli "parse_args reset mode"
assert_eq "$INSTALL_LANGUAGES" "" "parse_args resets languages"
assert_eq "$INSTALL_COMMAND" menu "parse_args resets command"
assert_eq "$NONINTERACTIVE" false "parse_args resets non-interactive"
assert_eq "$DRY_RUN" true "parse_args preserves current dry-run flag"

# A fresh invocation must start from the process contract, not state left by
# a previous parse. Environment variables remain a supported compatibility
# surface for callers that used the legacy deployer directly.
unset SANDKASTEN_INSTALL_MODE SANDKASTEN_LANGUAGES SANDKASTEN_NONINTERACTIVE SANDKASTEN_DRY_RUN
parse_args --mode webui --languages CORE --non-interactive install
assert_eq "$INSTALL_MODE" webui "parse_args environment reset mode"
assert_eq "$INSTALL_LANGUAGES" "go,bash,c,css,cpp,html,java,javascript,lua,php,python,ruby,rust,sql,typescript" "parse_args case-insensitive preset"
parse_args status
assert_eq "$INSTALL_MODE" cli "parse_args clean default mode"
assert_eq "$INSTALL_LANGUAGES" "" "parse_args clean default languages"
assert_eq "$NONINTERACTIVE" false "parse_args clean default interactivity"
assert_eq "$DRY_RUN" false "parse_args clean default dry-run"

assert_status 2 parse_languages 'python,,go'
assert_status 2 parse_languages '1-999999999'

SANDKASTEN_INSTALL_MODE=webui SANDKASTEN_LANGUAGES='2,4-5' \
  SANDKASTEN_NONINTERACTIVE=true SANDKASTEN_DRY_RUN=true \
  parse_args status
assert_eq "$INSTALL_MODE" webui "parse_args legacy mode env"
assert_eq "$INSTALL_LANGUAGES" "assembly,c,cangjie" "parse_args legacy language env"
assert_eq "$NONINTERACTIVE" true "parse_args legacy non-interactive env"
assert_eq "$DRY_RUN" true "parse_args legacy dry-run env"
unset SANDKASTEN_INSTALL_MODE SANDKASTEN_LANGUAGES SANDKASTEN_NONINTERACTIVE SANDKASTEN_DRY_RUN
SANDKASTEN_INSTALL_MODE=desktop
assert_status 2 parse_args status
unset SANDKASTEN_INSTALL_MODE

# Dry-run is side-effect free and prints the resolved invocation contract.
dry_run_output="$(installer_main --dry-run --mode cli --languages python,typescript install)"
assert_eq "$dry_run_output" $'mode=cli\nlanguages=python,typescript\ncommand=install' "dry-run output"

# A bare interactive invocation asks for the deployment mode before handing
# control to the legacy deployment flow.
run_legacy_command() { printf '%s:%s\n' "$INSTALL_MODE" "$INSTALL_COMMAND"; }
SANDKASTEN_INSTALLER_TEST=0
mode_dispatch_file="$(mktemp)"
printf 'webui\n' | installer_main >"$mode_dispatch_file"
mode_dispatch_output="$(<"$mode_dispatch_file")"
rm -f "$mode_dispatch_file"
assert_contains "$mode_dispatch_output" "webui:menu" "bare invocation mode dispatch"
assert_contains "$mode_dispatch_output" "Deployment mode" "bare invocation mode prompt"
mode_eof_file="$(mktemp)"
installer_main </dev/null >"$mode_eof_file"
mode_eof_output="$(<"$mode_eof_file")"
rm -f "$mode_eof_file"
assert_contains "$mode_eof_output" "cli:menu" "EOF mode defaults to cli"
unset -f run_legacy_command

# Legacy environment-driven language selection rejects invalid and empty sets.
source_legacy_deploy "$ROOT_DIR/werkzeug/deploy.sh"
set +e
SANDKASTEN_LANGUAGES='does-not-exist' select_languages >/dev/null 2>&1
invalid_status=$?
SANDKASTEN_LANGUAGES='1-999' select_languages >/dev/null 2>&1
range_status=$?
SANDKASTEN_LANGUAGES='   ' select_languages >/dev/null 2>&1
empty_status=$?
set -e
assert_eq "$invalid_status" 2 "legacy invalid language selection"
assert_eq "$range_status" 2 "legacy out-of-range language selection"
assert_eq "$empty_status" 2 "legacy empty language selection"
set +e
SANDKASTEN_LANGUAGES='python,,go' select_languages >/dev/null 2>&1
comma_status=$?
SANDKASTEN_LANGUAGES='0008' select_languages >/dev/null 2>&1
leading_zero_status=$?
SANDKASTEN_LANGUAGES='1-999999999' select_languages >/dev/null 2>&1
huge_range_status=$?
set -e
assert_eq "$comma_status" 2 "legacy empty CSV token"
assert_eq "$leading_zero_status" 2 "legacy invalid leading-zero number"
assert_eq "$huge_range_status" 2 "legacy huge language range"

retry_file="$(mktemp)"
printf '0\n' >"$retry_file"
ask() {
  local count
  count="$(<"$retry_file")"
  count=$((count + 1))
  printf '%s\n' "$count" >"$retry_file"
  if (( count == 1 )); then printf 'does-not-exist'; else printf 'core'; fi
}
confirm() { return 0; }
unset SANDKASTEN_LANGUAGES
select_languages >/dev/null
retry_count="$(<"$retry_file")"
rm -f "$retry_file"
assert_eq "$retry_count" 2 "legacy interactive language retry"
unset -f ask confirm

# Sourcing the legacy file is a definition-only operation for the modular
# entrypoint; its main dispatcher must not run at the source boundary.
source_probe="$(source_legacy_deploy "$ROOT_DIR/werkzeug/deploy.sh"; printf source-ok)"
assert_eq "$source_probe" source-ok "legacy source boundary"

printf 'installer parser tests: ok\n'
