#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
assert_file() { [[ -f "$1" ]] || fail "missing file: $1"; }
assert_contains() { grep -Fq -- "$2" "$1" || fail "'$2' not found in $1"; }
assert_not_contains() { ! grep -Fq -- "$2" "$1" || fail "unexpected '$2' in $1"; }
assert_failure() {
  local label="$1"
  shift
  if "$@"; then
    fail "expected failure: $label"
  fi
}

export REPO_ROOT="$TMP_DIR/repo"
export HTTP_PORT=9191
export WEBUI_ROOT="$TMP_DIR/webui"
export NGINX_SITE_AVAIL="$TMP_DIR/nginx/sites-available/sandkasten.conf"
export NGINX_SITE_ENABLED="$TMP_DIR/nginx/sites-enabled/sandkasten.conf"
export DRY_RUN=false
export SANDKASTEN_INSTALL_MODE=webui
mkdir -p "$REPO_ROOT/webui" "$(dirname "$NGINX_SITE_AVAIL")" "$(dirname "$NGINX_SITE_ENABLED")"
printf 'source-only\n' > "$REPO_ROOT/webui/src-placeholder.ts"
printf '<!doctype html> source template\n' > "$REPO_ROOT/webui/index.html"

# shellcheck source=/dev/null
source "$ROOT_DIR/werkzeug/installer/webui.sh"

assert_failure "source without dist" validate_webui_source

mkdir -p "$REPO_ROOT/webui/dist"
printf '<!doctype html>\n' > "$REPO_ROOT/webui/dist/index.html"
printf 'console.log(1)\n' > "$REPO_ROOT/webui/dist/app.js"
printf ':root {}\n' > "$REPO_ROOT/webui/dist/styles.css"

assert_failure "dist missing config.js" validate_webui_source
printf 'globalThis.SANDKASTEN_CONFIG = {};\n' > "$REPO_ROOT/webui/dist/config.js"
printf 'stale\n' > "$REPO_ROOT/webui/dist/extra.txt"
assert_failure "dist with extra file" validate_webui_source
rm "$REPO_ROOT/webui/dist/extra.txt"

mkdir "$REPO_ROOT/webui/dist/nested"
assert_failure "dist with nested directory" validate_webui_source
rmdir "$REPO_ROOT/webui/dist/nested"

ln -s index.html "$REPO_ROOT/webui/dist/linked.html"
assert_failure "dist with symlink" validate_webui_source
rm "$REPO_ROOT/webui/dist/linked.html"

rm "$REPO_ROOT/webui/dist/config.js"
ln -s app.js "$REPO_ROOT/webui/dist/config.js"
assert_failure "dist with expected symlink" validate_webui_source
rm "$REPO_ROOT/webui/dist/config.js"
printf 'globalThis.SANDKASTEN_CONFIG = {};\n' > "$REPO_ROOT/webui/dist/config.js"

validate_webui_source
install_webui_assets
assert_file "$WEBUI_ROOT/index.html"
assert_file "$WEBUI_ROOT/.sandkasten-webui-managed"
for asset in index.html app.js styles.css config.js; do
  assert_file "$WEBUI_ROOT/$asset"
  [[ "$(stat -c '%a' "$WEBUI_ROOT/$asset")" == 644 ]] || fail "WebUI asset is not Nginx-readable: $asset"
done
[[ "$(stat -c '%a' "$WEBUI_ROOT")" == 755 ]] || fail 'WebUI root is not traversable by Nginx'
[[ "$(stat -c '%a' "$WEBUI_ROOT/.sandkasten-webui-managed")" == 644 ]] || fail 'WebUI ownership marker has unexpected permissions'
[[ "$(find "$WEBUI_ROOT" -mindepth 1 -maxdepth 1 -type f ! -name '.sandkasten-webui-managed' | wc -l)" -eq 4 ]] || fail 'installer copied files outside the four-file payload'
[[ ! -e "$WEBUI_ROOT/src-placeholder.ts" ]] || fail 'installer copied WebUI source files'

# Server installation consumes the prebuilt payload and never invokes Node/npm.
npm() { fail 'installer invoked npm'; }
node() { fail 'installer invoked node'; }
install_webui_assets
unset -f npm node

# A staging-permission failure must abort before replacing the managed tree.
chmod() { return 1; }
assert_failure "staging permission failure" install_webui_assets
unset -f chmod
assert_contains "$WEBUI_ROOT/index.html" '<!doctype html>'

# A failed validation must leave the last managed install intact.
printf 'stale\n' > "$REPO_ROOT/webui/dist/extra.txt"
assert_failure "invalid upgrade" install_webui_assets
assert_contains "$WEBUI_ROOT/index.html" '<!doctype html>'
rm "$REPO_ROOT/webui/dist/extra.txt"

# Existing unmanaged destinations remain protected.
unmanaged_root="$TMP_DIR/unmanaged-webui"
mkdir -p "$unmanaged_root"
printf 'keep\n' > "$unmanaged_root/user-data.txt"
WEBUI_ROOT="$unmanaged_root"
assert_failure "unmanaged destination" install_webui_assets
assert_file "$unmanaged_root/user-data.txt"
WEBUI_ROOT="$TMP_DIR/webui"

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

# The repository quality entrypoint must execute the final Task 5 WebUI
# commands. A fixture verifies the integration contract without copying those
# concurrently developed scripts into this branch.
QUALITY_SCRIPT="$ROOT_DIR/werkzeug/quality/test.sh"
assert_contains "$QUALITY_SCRIPT" 'SANDKASTEN_QUALITY_ROOT'
quality_root="$TMP_DIR/quality-root"
quality_events="$TMP_DIR/quality-events.log"
mkdir -p "$quality_root/webui" "$quality_root/scripts" "$quality_root/bin"
printf '{}\n' > "$quality_root/webui/package.json"
cat > "$quality_root/bin/npm" <<'NPM'
#!/usr/bin/env bash
printf 'npm:%s:%s\n' "$PWD" "$*" >> "$QUALITY_EVENTS"
NPM
cat > "$quality_root/scripts/webui-build-test.sh" <<'BUILD_TEST'
#!/usr/bin/env bash
printf 'webui-build:%s\n' "$*" >> "$QUALITY_EVENTS"
BUILD_TEST
cat > "$quality_root/scripts/pages-artifact-test.sh" <<'PAGES_TEST'
#!/usr/bin/env bash
printf 'pages-artifact:%s\n' "$*" >> "$QUALITY_EVENTS"
PAGES_TEST
chmod +x "$quality_root/bin/npm" "$quality_root/scripts/webui-build-test.sh" "$quality_root/scripts/pages-artifact-test.sh"
QUALITY_EVENTS="$quality_events" \
  SANDKASTEN_QUALITY_ROOT="$quality_root" \
  PATH="$quality_root/bin:/usr/bin:/bin" \
  bash "$QUALITY_SCRIPT"
assert_contains "$quality_events" "npm:$quality_root/webui:ci"
assert_contains "$quality_events" "npm:$quality_root/webui:test"
assert_contains "$quality_events" "npm:$quality_root/webui:run build"
assert_contains "$quality_events" 'webui-build:'
assert_contains "$quality_events" 'pages-artifact:--test'

printf 'webui deployment tests: ok\n'
