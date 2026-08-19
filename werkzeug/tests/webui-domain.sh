#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
assert_contains() { grep -Fq -- "$2" "$1" || fail "'$2' not found in $1"; }
assert_not_contains() { ! grep -Fq -- "$2" "$1" || fail "unexpected '$2' in $1"; }

# shellcheck source=/dev/null
source "$ROOT_DIR/werkzeug/installer/entrypoint.sh"
source_legacy_deploy "$ROOT_DIR/werkzeug/deploy.sh"

export HTTP_PORT=9191
export WEBUI_ROOT="$TMP_DIR/webui"
export SANDKASTEN_INSTALL_MODE=webui
render_domain_nginx_site "$TMP_DIR/webui.conf" run.example.test
assert_contains "$TMP_DIR/webui.conf" '# sandkasten-webui-managed'
assert_contains "$TMP_DIR/webui.conf" 'server_name run.example.test;'
assert_contains "$TMP_DIR/webui.conf" "root $WEBUI_ROOT;"
assert_contains "$TMP_DIR/webui.conf" 'try_files $uri $uri/ /index.html;'
assert_contains "$TMP_DIR/webui.conf" 'location /v1/'
assert_contains "$TMP_DIR/webui.conf" 'location = /healthz'
assert_contains "$TMP_DIR/webui.conf" 'proxy_pass http://127.0.0.1:9191;'

export SANDKASTEN_INSTALL_MODE=cli
render_domain_nginx_site "$TMP_DIR/cli.conf" cli.example.test
assert_not_contains "$TMP_DIR/cli.conf" '# sandkasten-webui-managed'
assert_not_contains "$TMP_DIR/cli.conf" 'try_files'
assert_contains "$TMP_DIR/cli.conf" 'proxy_pass http://127.0.0.1:9191;'

printf 'unmanaged\n' > "$TMP_DIR/unmanaged.conf"
if render_webui_nginx_config "$TMP_DIR/unmanaged.conf"; then
  fail 'renderer replaced an unmanaged Nginx config'
fi
ln -sfn "$TMP_DIR/unmanaged.conf" "$TMP_DIR/unmanaged-link.conf"
if render_webui_nginx_config "$TMP_DIR/unmanaged-link.conf"; then
  fail 'renderer replaced an Nginx symlink'
fi

export SANDKASTEN_INSTALL_MODE=webui
WEBUI_ROOT="$TMP_DIR/webui"
printf 'unmanaged\n' > "$TMP_DIR/domain-unmanaged.conf"
if render_domain_nginx_site "$TMP_DIR/domain-unmanaged.conf" valid.example.test; then
  fail 'domain renderer replaced an unmanaged available site'
fi
ln -sfn "$TMP_DIR/domain-unmanaged.conf" "$TMP_DIR/domain-link.conf"
if render_domain_nginx_site "$TMP_DIR/domain-link.conf" valid.example.test; then
  fail 'domain renderer replaced an available symlink'
fi
if render_domain_nginx_site "$TMP_DIR/invalid.conf" 'bad domain'; then
  fail 'domain validation accepted whitespace'
fi
WEBUI_ROOT="$TMP_DIR/unsafe
root"
if render_domain_nginx_site "$TMP_DIR/invalid-root.conf" valid.example.test; then
  fail 'WebUI root validation accepted a newline'
fi

printf 'webui domain template tests: ok\n'
