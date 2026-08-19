#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
assert_file() { [[ -f "$1" ]] || fail "missing file: $1"; }
assert_contains() { grep -Fq -- "$2" "$1" || fail "'$2' not found in $1"; }
assert_not_contains() { ! grep -Fq -- "$2" "$1" || fail "unexpected '$2' in $1"; }

export REPO_ROOT="$TMP_DIR/repo"
export HTTP_PORT=9191
export WEBUI_ROOT="$TMP_DIR/webui"
export NGINX_SITE_AVAIL="$TMP_DIR/nginx/sites-available/sandkasten.conf"
export NGINX_SITE_ENABLED="$TMP_DIR/nginx/sites-enabled/sandkasten.conf"
export DRY_RUN=false
export SANDKASTEN_INSTALL_MODE=webui
mkdir -p "$REPO_ROOT/webui" "$(dirname "$NGINX_SITE_AVAIL")" "$(dirname "$NGINX_SITE_ENABLED")"
printf '<!doctype html>\n' > "$REPO_ROOT/webui/index.html"
printf 'console.log(1)\n' > "$REPO_ROOT/webui/app.js"

# shellcheck source=/dev/null
source "$ROOT_DIR/werkzeug/installer/webui.sh"

validate_webui_source
install_webui_assets
assert_file "$WEBUI_ROOT/index.html"
assert_file "$WEBUI_ROOT/.sandkasten-webui-managed"

render_webui_nginx_config "$NGINX_SITE_AVAIL"
assert_contains "$NGINX_SITE_AVAIL" "root $WEBUI_ROOT;"
assert_contains "$NGINX_SITE_AVAIL" "location /v1/"
assert_contains "$NGINX_SITE_AVAIL" "location = /healthz"
assert_contains "$NGINX_SITE_AVAIL" "proxy_pass http://127.0.0.1:$HTTP_PORT;"

export SANDKASTEN_INSTALL_MODE=cli
render_webui_nginx_config "$TMP_DIR/cli.conf"
assert_not_contains "$TMP_DIR/cli.conf" "root $WEBUI_ROOT;"
assert_not_contains "$TMP_DIR/cli.conf" "try_files"
assert_contains "$TMP_DIR/cli.conf" "location /v1/"

# Dry-run must not create or replace assets.
rm -rf "$WEBUI_ROOT"
export DRY_RUN=true
install_webui_assets
[[ ! -e "$WEBUI_ROOT" ]] || fail 'dry-run created WebUI assets'

printf 'webui deployment tests: ok\n'
