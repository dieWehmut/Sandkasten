#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UNINSTALL="$ROOT_DIR/werkzeug/uninstall.sh"
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

toolchain_body="$(sed -n '/^remove_toolchains()/,/^}/p' "$UNINSTALL")"
[[ "$toolchain_body" != *'"/opt/sandkasten"'* ]] || fail 'remove_toolchains must not remove the /opt/sandkasten root'
[[ "$toolchain_body" != *'remove_webui_assets'* ]] || fail 'toolchain confirmation must not implicitly remove WebUI assets'

grep -q '_confirm_remove_webui_assets' "$UNINSTALL" || fail 'Nginx cleanup must use confirmed WebUI cleanup'
grep -q '^_uninstall_webui_assets_owned()' "$UNINSTALL" || fail 'standalone uninstaller lacks strict WebUI ownership validation'
webui_confirm_line="$(grep -n 'if confirm_step "delete managed WebUI assets' "$UNINSTALL" | head -1 | cut -d: -f1)"
webui_remove_line="$(grep -n 'remove_webui_assets ||' "$UNINSTALL" | head -1 | cut -d: -f1)"
[[ "$webui_remove_line" -gt "$webui_confirm_line" ]] || fail 'WebUI assets must be removed after WebUI confirmation'
webui_confirm_body="$(sed -n '/^_confirm_remove_webui_assets()/,/^}/p' "$UNINSTALL")"
[[ "$webui_confirm_body" == *'_uninstall_webui_assets_owned'* ]] || fail 'WebUI confirmation accepts an unverified ownership marker'
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
mkdir -p "$tmp_dir/no-realpath"
cat > "$tmp_dir/no-realpath/realpath" <<'REALPATH'
#!/usr/bin/env bash
exit 1
REALPATH
chmod +x "$tmp_dir/no-realpath/realpath"
ln -s / "$tmp_dir/root-link"
saved_path="$PATH"
PATH="$tmp_dir/no-realpath:$PATH"
WEBUI_ROOT="$tmp_dir/root-link"
if validate_webui_root; then
  PATH="$saved_path"
  fail 'WebUI root validation accepted a protected alias without realpath'
fi
PATH="$saved_path"
WEBUI_ROOT="$SANDKASTEN_WEBUI_DIR"
mkdir -p "$WEBUI_ROOT"
printf 'unmanaged\n' > "$WEBUI_ROOT/user-data.txt"
remove_webui_assets
[[ -e "$WEBUI_ROOT/user-data.txt" ]] || fail 'unmanaged WebUI data was removed'

printf 'not-sandkasten\n' > "$WEBUI_ROOT/.sandkasten-webui-managed"
remove_webui_assets
[[ -e "$WEBUI_ROOT/user-data.txt" ]] || fail 'WebUI data with an invalid marker was removed'

rm "$WEBUI_ROOT/.sandkasten-webui-managed"
printf 'managed-by=sandkasten\n' > "$tmp_dir/marker-target"
ln -s "$tmp_dir/marker-target" "$WEBUI_ROOT/.sandkasten-webui-managed"
remove_webui_assets
[[ -e "$WEBUI_ROOT/user-data.txt" ]] || fail 'WebUI data with a symlink marker was removed'

rm "$WEBUI_ROOT/.sandkasten-webui-managed"
printf 'managed-by=sandkasten\n' > "$WEBUI_ROOT/.sandkasten-webui-managed"
managed_alias="$tmp_dir/managed-alias"
ln -s "$WEBUI_ROOT" "$managed_alias"
WEBUI_ROOT="$managed_alias"
remove_webui_assets
[[ -L "$managed_alias" && -e "$SANDKASTEN_WEBUI_DIR/user-data.txt" ]] || fail 'WebUI root symlink was treated as an owned installation'

WEBUI_ROOT="$SANDKASTEN_WEBUI_DIR"
remove_webui_assets
[[ ! -e "$WEBUI_ROOT" ]] || fail 'managed WebUI directory was not removed'

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
