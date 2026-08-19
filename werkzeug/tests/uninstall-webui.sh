#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UNINSTALL="$ROOT_DIR/werkzeug/uninstall.sh"
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

toolchain_body="$(sed -n '/^remove_toolchains()/,/^}/p' "$UNINSTALL")"
[[ "$toolchain_body" != *'"/opt/sandkasten"'* ]] || fail 'remove_toolchains must not remove the /opt/sandkasten root'
[[ "$toolchain_body" == *'remove_webui_assets'* ]] || fail 'toolchain cleanup must use marker-gated WebUI cleanup'

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
export SANDKASTEN_WEBUI_DIR="$tmp_dir/custom-webui"
unset WEBUI_ROOT
# shellcheck disable=SC1090
source "$ROOT_DIR/werkzeug/installer/webui.sh"
[[ "$WEBUI_ROOT" == "$SANDKASTEN_WEBUI_DIR" ]] || fail 'SANDKASTEN_WEBUI_DIR was not mapped to WEBUI_ROOT'
mkdir -p "$WEBUI_ROOT"
printf 'unmanaged\n' > "$WEBUI_ROOT/user-data.txt"
remove_webui_assets
[[ -e "$WEBUI_ROOT/user-data.txt" ]] || fail 'unmanaged WebUI data was removed'
printf 'uninstall WebUI safety tests: ok\n'
