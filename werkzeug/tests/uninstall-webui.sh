#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UNINSTALL="$ROOT_DIR/werkzeug/uninstall.sh"
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

toolchain_body="$(sed -n '/^remove_toolchains()/,/^}/p' "$UNINSTALL")"
[[ "$toolchain_body" != *'"/opt/sandkasten"'* ]] || fail 'remove_toolchains must not remove the /opt/sandkasten root'
[[ "$toolchain_body" != *'remove_webui_assets'* ]] || fail 'toolchain confirmation must not implicitly remove WebUI assets'

grep -q '_confirm_remove_webui_assets' "$UNINSTALL" || fail 'Nginx cleanup must use confirmed WebUI cleanup'
webui_confirm_line="$(grep -n 'if confirm_step "delete managed WebUI assets' "$UNINSTALL" | head -1 | cut -d: -f1)"
webui_remove_line="$(grep -n 'remove_webui_assets ||' "$UNINSTALL" | head -1 | cut -d: -f1)"
[[ "$webui_remove_line" -gt "$webui_confirm_line" ]] || fail 'WebUI assets must be removed after WebUI confirmation'
nginx_body="$(sed -n '/^remove_nginx()/,/^}/p' "$UNINSTALL")"
grep -q '^_uninstall_webui_root_safe()' "$UNINSTALL" || fail 'fallback WebUI cleanup lacks path guard'
[[ "$nginx_body" == *'_confirm_remove_webui_assets'* ]] || fail 'Nginx cleanup misses WebUI confirmation path'
[[ "$nginx_body" == *'[[ -L "$site_enabled" ]]'* ]] || fail 'fallback Nginx cleanup lacks symlink ownership check'

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
export SANDKASTEN_WEBUI_DIR="$tmp_dir/custom-webui"
unset WEBUI_ROOT
# shellcheck disable=SC1090
source "$ROOT_DIR/werkzeug/installer/webui.sh"
[[ "$WEBUI_ROOT" == "$SANDKASTEN_WEBUI_DIR" ]] || fail 'SANDKASTEN_WEBUI_DIR was not mapped to WEBUI_ROOT'

for unsafe_root in / /opt /opt/sandkasten /opt/../etc; do
  WEBUI_ROOT="$unsafe_root"
  if validate_webui_root; then
    fail "unsafe WebUI root accepted: $unsafe_root"
  fi
done
WEBUI_ROOT="$SANDKASTEN_WEBUI_DIR"
mkdir -p "$WEBUI_ROOT"
printf 'unmanaged\n' > "$WEBUI_ROOT/user-data.txt"
remove_webui_assets
[[ -e "$WEBUI_ROOT/user-data.txt" ]] || fail 'unmanaged WebUI data was removed'

avail="$tmp_dir/sandkasten.conf"
enabled="$tmp_dir/enabled.conf"
printf '# sandkasten-webui-managed\n' > "$avail"
printf 'unrelated\n' > "$enabled"
remove_managed_webui_nginx "$avail" "$enabled"
[[ -e "$avail" && -e "$enabled" ]] || fail 'unrelated regular enabled file was removed'
ln -sf "$avail" "$enabled"
remove_managed_webui_nginx "$avail" "$enabled"
[[ ! -e "$avail" && ! -e "$enabled" ]] || fail 'managed Nginx symlink/config was not removed'
printf 'uninstall WebUI safety tests: ok\n'
