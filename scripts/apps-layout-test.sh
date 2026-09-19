#!/usr/bin/env bash
# Lock the apps/ layout boundary: the web payload stays exactly four files and
# no live file may fall back to the removed top-level webui/ tree.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
fail() { printf 'apps layout test: %s\n' "$*" >&2; return 1; }

check_web_distribution() {
  local dist="$ROOT/apps/web/dist" expected=(app.js config.js index.html styles.css) actual=()
  [[ -d "$dist" && ! -L "$dist" ]] || { fail "missing web distribution: $dist"; return 1; }
  mapfile -t actual < <(find "$dist" -mindepth 1 -printf '%P\n' | LC_ALL=C sort)
  [[ "${#actual[@]}" -eq "${#expected[@]}" ]] || {
    printf 'expected: %s\nactual: %s\n' "${expected[*]}" "${actual[*]}" >&2
    fail 'the web distribution must contain exactly four files'
    return 1
  }
  local index
  for index in "${!expected[@]}"; do
    [[ "${actual[$index]}" == "${expected[$index]}" ]] || { fail 'unexpected distribution entry'; return 1; }
    [[ -f "$dist/${expected[$index]}" && ! -L "$dist/${expected[$index]}" ]] || {
      fail "distribution entry is not a regular file: ${expected[$index]}"
      return 1
    }
  done
}

check_no_stale_webui_tree() {
  [[ ! -e "$ROOT/webui" ]] || { fail 'the top-level webui/ directory must be removed after the apps/web migration'; return 1; }
}

check_no_live_webui_paths() {
  local matches
  matches="$(grep -rIl --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=target --exclude-dir=prompt --exclude-dir=tmp \
    --exclude=apps-layout-test.sh \
    -e 'webui/dist' -e 'webui/src' -e 'webui/app\.js' -e 'webui/styles\.css' \
    "$ROOT/.github" "$ROOT/scripts" "$ROOT/werkzeug" "$ROOT/handbuch" "$ROOT/README.md" "$ROOT/apps" 2>/dev/null || true)"
  [[ -z "$matches" ]] || {
    printf 'stale webui/ references:\n%s\n' "$matches" >&2
    fail 'live files must reference apps/web instead of the removed webui/ tree'
    return 1
  }
}

check_apps_entrypoints() {
  [[ -f "$ROOT/apps/web/package.json" ]] || { fail 'apps/web/package.json is required'; return 1; }
  [[ -f "$ROOT/apps/web/src/main.ts" ]] || { fail 'apps/web/src/main.ts is required'; return 1; }
}

check_all_app_entrypoints() {
  local entries=(
    "apps/web/package.json"
    "apps/web/dist/index.html"
    "apps/cli/package.json"
    "apps/cli/bin/sandkasten.mjs"
    "apps/cli/src/api.mjs"
    "apps/desktop/package.json"
    "apps/desktop/src/main.mjs"
    "apps/desktop/src/preload.cjs"
  )
  local entry
  for entry in "${entries[@]}"; do
    [[ -f "$ROOT/$entry" && ! -L "$ROOT/$entry" ]] || { fail "missing app entrypoint: $entry"; return 1; }
  done
}

check_web_distribution
check_no_stale_webui_tree
check_no_live_webui_paths
check_apps_entrypoints
check_all_app_entrypoints

printf 'apps layout tests: ok\n'
