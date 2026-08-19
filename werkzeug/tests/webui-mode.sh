#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
assert_eq() { [[ "$1" == "$2" ]] || fail "$3 (expected '$2', got '$1')"; }
assert_file() { [[ -f "$1" ]] || fail "missing file: $1"; }
assert_not_file() { [[ ! -e "$1" ]] || fail "unexpected path: $1"; }

EVENTS="$TMP_DIR/events"
DEPLOY_DIR="$TMP_DIR/installer"
BIN_DIR="$TMP_DIR/bin"
export NGINX_SITE_AVAIL="$TMP_DIR/nginx/sites-available/sandkasten.conf"
export NGINX_SITE_ENABLED="$TMP_DIR/nginx/sites-enabled/sandkasten.conf"
mkdir -p "$DEPLOY_DIR" "$BIN_DIR"
cat > "$BIN_DIR/nginx" <<'NGINX'
#!/usr/bin/env bash
[[ "${1:-}" == -t ]]
NGINX
cat > "$BIN_DIR/systemctl" <<'SYSTEMCTL'
#!/usr/bin/env bash
printf 'systemctl:%s\n' "$*" >> "$EVENTS"
SYSTEMCTL
chmod +x "$BIN_DIR/nginx" "$BIN_DIR/systemctl"
export PATH="$BIN_DIR:$PATH"
cat > "$TMP_DIR/deploy.sh" <<'DEPLOY'
require_root() { :; }
detect_os() { :; }
run_install() {
  printf 'backend:%s:%s\n' "$SANDKASTEN_INSTALL_MODE" "$SANDKASTEN_LANGUAGES" >> "$EVENTS"
  if [[ "$SANDKASTEN_INSTALL_MODE" == webui ]]; then
    mkdir -p "$(dirname "$NGINX_SITE_AVAIL")"
    printf '# sandkasten-webui-managed\n' > "$NGINX_SITE_AVAIL"
  fi
}
uninstall_all() { printf 'backend-uninstall\n' >> "$EVENTS"; }
confirm() { return 1; }
info() { :; }
DEPLOY

export EVENTS
export SANDKASTEN_INSTALLER_TEST=0
# shellcheck source=/dev/null
source "$ROOT_DIR/werkzeug/installer/entrypoint.sh"
_INSTALLER_DIR="$DEPLOY_DIR"

install_webui_assets() { printf 'assets:%s\n' "$WEBUI_ROOT" >> "$EVENTS"; }
render_webui_nginx_config() { printf 'render\n' >> "$EVENTS"; }
remove_webui_assets() { printf 'remove-assets\n' >> "$EVENTS"; }
remove_webui_nginx_config() { printf 'remove-nginx\n' >> "$EVENTS"; }

export SANDKASTEN_INSTALL_MODE=webui
export SANDKASTEN_WEBUI_DIR="$TMP_DIR/custom-webui"
installer_main --mode webui --languages python --non-interactive install
expected_webui_events="$(printf 'backend:webui:python\nassets:%s\nrender\nsystemctl:reload nginx' "$TMP_DIR/custom-webui")"
assert_eq "$(<"$EVENTS")" "$expected_webui_events" \
  'webui install order'
[[ -L "$NGINX_SITE_ENABLED" ]] || fail 'WebUI Nginx site was not enabled'
assert_eq "$(readlink "$NGINX_SITE_ENABLED")" "$NGINX_SITE_AVAIL" 'enabled WebUI site target'

# The documented non-interactive invocation omits the optional install
# subcommand; the default menu command must still deploy the WebUI assets.
: > "$EVENTS"
installer_main --mode webui --languages python --non-interactive
expected_webui_default_events="$(printf 'backend:webui:python\nassets:%s\nrender\nsystemctl:reload nginx' "$TMP_DIR/custom-webui")"
assert_eq "$(<"$EVENTS")" "$expected_webui_default_events" \
  'default WebUI invocation must deploy assets'

printf 'unmanaged\n' > "$TMP_DIR/nginx/unmanaged.conf"
ln -sfn "$TMP_DIR/nginx/unmanaged.conf" "$NGINX_SITE_ENABLED"
if activate_webui_nginx; then
  fail 'activation replaced an unmanaged Nginx symlink'
fi
rm -f "$NGINX_SITE_ENABLED"

: > "$EVENTS"
export SANDKASTEN_INSTALL_MODE=cli
installer_main --mode cli --languages python --non-interactive install
assert_eq "$(<"$EVENTS")" 'backend:cli:python' 'CLI must not deploy WebUI assets'
assert_not_file "$TMP_DIR/webui"

# CLI uninstall dry-run must execute the standalone preview when available,
# rather than stopping at the modular parser summary.
cat > "$TMP_DIR/uninstall.sh" <<'UNINSTALL'
#!/usr/bin/env bash
printf 'uninstaller:%s\n' "$*" >> "$EVENTS"
UNINSTALL
chmod +x "$TMP_DIR/uninstall.sh"
: > "$EVENTS"
installer_main --mode cli --dry-run uninstall
assert_eq "$(<"$EVENTS")" 'uninstaller:--dry-run' 'CLI uninstall dry-run dispatch'
rm -f "$TMP_DIR/uninstall.sh"

# Interactive WebUI uninstall must confirm before removing marker-owned files.
: > "$EVENTS"
installer_main --mode webui uninstall
assert_eq "$(<"$EVENTS")" '' 'WebUI uninstall confirmation'

# A real checkout keeps WebUI uninstall on the entrypoint's marker-aware
# cleanup path, even when a sibling standalone uninstaller exists.
cat > "$TMP_DIR/uninstall.sh" <<'UNINSTALL'
#!/usr/bin/env bash
printf 'unexpected-standalone\n' >> "$EVENTS"
UNINSTALL
chmod +x "$TMP_DIR/uninstall.sh"
: > "$EVENTS"
installer_main --mode webui --dry-run uninstall
assert_eq "$(<"$EVENTS")" $'remove-assets\nremove-nginx' \
  'WebUI uninstall dry-run must use marker-aware cleanup'

: > "$EVENTS"
installer_main --mode webui --yes uninstall
assert_eq "$(<"$EVENTS")" $'remove-assets\nremove-nginx\nsystemctl:reload nginx\nbackend-uninstall' \
  'WebUI uninstall must reload Nginx without standalone dispatch'
rm -f "$TMP_DIR/uninstall.sh"

printf 'webui mode integration tests: ok\n'
