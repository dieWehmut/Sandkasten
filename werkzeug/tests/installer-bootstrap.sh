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
cat > "$fixture/deploy.sh" <<'DEPLOY'
require_root() { :; }
detect_os() { :; }
uninstall_all() { printf 'legacy-uninstall\n'; }
confirm() { return 0; }
info() { :; }
DEPLOY
cat > "$fixture/uninstall.sh" <<'UNINSTALL'
#!/usr/bin/env bash
printf 'standalone-uninstaller:%s\n' "$*"
UNINSTALL
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

# The default bootstrap downloads one repository snapshot so all staged
# modules come from the same revision. The explicit base-URL path above stays
# available for mirrors and offline fixtures.
archive_tree="$TMP_DIR/archive-tree/sandkasten-snapshot/werkzeug"
mkdir -p "$archive_tree/installer"
cp "$fixture/deploy.sh" "$fixture/uninstall.sh" "$archive_tree/"
cp "$fixture/installer/entrypoint.sh" "$fixture/installer/lib.sh" \
  "$fixture/installer/languages.sh" "$fixture/installer/webui.sh" \
  "$archive_tree/installer/"
archive_fixture="$TMP_DIR/sandkasten-snapshot.tar.gz"
tar -czf "$archive_fixture" -C "$TMP_DIR/archive-tree" sandkasten-snapshot
download_log="$TMP_DIR/archive-downloads"
archive_downloader="$TMP_DIR/archive-downloader"
cat > "$archive_downloader" <<'DOWNLOADER'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$1" >> "$SANDKASTEN_DOWNLOAD_LOG"
cp "$SANDKASTEN_ARCHIVE_FIXTURE" "$2"
DOWNLOADER
chmod +x "$archive_downloader"
archive_url='https://downloads.example.test/sandkasten-snapshot.tar.gz'
archive_output="$(
  SANDKASTEN_INSTALL_ARCHIVE_URL="$archive_url" \
    SANDKASTEN_INSTALL_DOWNLOADER="$archive_downloader" \
    SANDKASTEN_ARCHIVE_FIXTURE="$archive_fixture" \
    SANDKASTEN_DOWNLOAD_LOG="$download_log" \
    SANDKASTEN_BOOTSTRAP_TEST=1 \
    bash "$TMP_DIR/standalone/install.sh"
)"
assert_eq "$archive_output" 'install.sh: bootstrap complete' "archive bootstrap"
assert_eq "$(wc -l < "$download_log" | tr -d ' ')" 1 "archive download count"
assert_eq "$(<"$download_log")" "$archive_url" "archive download URL"

: > "$download_log"
archive_run_output="$(
  SANDKASTEN_INSTALL_ARCHIVE_URL="$archive_url" \
    SANDKASTEN_INSTALL_DOWNLOADER="$archive_downloader" \
    SANDKASTEN_ARCHIVE_FIXTURE="$archive_fixture" \
    SANDKASTEN_DOWNLOAD_LOG="$download_log" \
    bash "$TMP_DIR/standalone/install.sh" --dry-run --mode webui --languages python install
)"
assert_eq "$archive_run_output" $'mode=webui\nlanguages=python\ncommand=install' \
  "archive entrypoint execution"
assert_eq "$(wc -l < "$download_log" | tr -d ' ')" 1 "archive run download count"

unsafe_tree="$TMP_DIR/unsafe-tree/sandkasten-snapshot/werkzeug"
mkdir -p "$unsafe_tree/installer"
cp "$fixture/deploy.sh" "$fixture/uninstall.sh" "$unsafe_tree/"
cp "$fixture/installer/entrypoint.sh" "$fixture/installer/lib.sh" \
  "$fixture/installer/languages.sh" "$unsafe_tree/installer/"
ln -s entrypoint.sh "$unsafe_tree/installer/webui.sh"
unsafe_archive="$TMP_DIR/unsafe-snapshot.tar.gz"
tar -czf "$unsafe_archive" -C "$TMP_DIR/unsafe-tree" sandkasten-snapshot
if SANDKASTEN_INSTALL_ARCHIVE_URL="$archive_url" \
  SANDKASTEN_INSTALL_DOWNLOADER="$archive_downloader" \
  SANDKASTEN_ARCHIVE_FIXTURE="$unsafe_archive" \
  SANDKASTEN_DOWNLOAD_LOG="$download_log" \
  SANDKASTEN_BOOTSTRAP_TEST=1 \
  bash "$TMP_DIR/standalone/install.sh" >/dev/null 2>&1; then
  fail 'archive bootstrap accepted a symlinked installer member'
fi

cleanup_tmp="$TMP_DIR/bootstrap-cleanup"
mkdir -p "$cleanup_tmp"
cleanup_output="$(
  TMPDIR="$cleanup_tmp" \
    SANDKASTEN_INSTALL_BASE_URL="file://$fixture" \
    bash "$TMP_DIR/standalone/install.sh" --dry-run --mode cli --languages go install
)"
assert_eq "$cleanup_output" $'mode=cli\nlanguages=go\ncommand=install' \
  "standalone cleanup invocation"
if find "$cleanup_tmp" -mindepth 1 -print -quit | grep -q .; then
  fail 'standalone bootstrap left its temporary staging directory behind'
fi

# Standalone downloads must use the modular parser regardless of where the
# uninstall command appears. In WebUI mode this keeps cleanup marker-aware and
# prevents --mode from leaking into the standalone uninstaller.
webui_root="$TMP_DIR/managed-webui"
nginx_available="$TMP_DIR/nginx/sites-available/sandkasten.conf"
nginx_enabled="$TMP_DIR/nginx/sites-enabled/sandkasten.conf"
uninstall_command_first="$({
  SANDKASTEN_INSTALL_BASE_URL="file://$fixture" \
    SANDKASTEN_WEBUI_DIR="$webui_root" \
    NGINX_SITE_AVAIL="$nginx_available" \
    NGINX_SITE_ENABLED="$nginx_enabled" \
    bash "$TMP_DIR/standalone/install.sh" uninstall --mode webui --dry-run
})"
uninstall_options_first="$({
  SANDKASTEN_INSTALL_BASE_URL="file://$fixture" \
    SANDKASTEN_WEBUI_DIR="$webui_root" \
    NGINX_SITE_AVAIL="$nginx_available" \
    NGINX_SITE_ENABLED="$nginx_enabled" \
    bash "$TMP_DIR/standalone/install.sh" --mode webui --dry-run uninstall
})"
assert_eq "$uninstall_command_first" "$uninstall_options_first" \
  "standalone WebUI uninstall argument order"

printf 'installer bootstrap tests: ok\n'
