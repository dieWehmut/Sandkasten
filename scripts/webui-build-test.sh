#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'webui build test: %s\n' "$*" >&2
  return 1
}

check_distribution() {
  local distribution_dir="${1:-}"
  [[ -n "$distribution_dir" ]] || { fail 'distribution directory is required'; return 1; }
  [[ -d "$distribution_dir" && ! -L "$distribution_dir" ]] || {
    fail "distribution directory does not exist or is a symbolic link: $distribution_dir"
    return 1
  }

  local expected=(app.js config.js index.html styles.css)
  local actual=()
  mapfile -t actual < <(find "$distribution_dir" -mindepth 1 -printf '%P\n' | LC_ALL=C sort)

  [[ "${#actual[@]}" -eq "${#expected[@]}" ]] || {
    printf 'expected entries: %s\nactual entries: %s\n' "${expected[*]}" "${actual[*]}" >&2
    fail 'distribution must contain exactly the four WebUI runtime files'
    return 1
  }

  local index
  for index in "${!expected[@]}"; do
    [[ "${actual[$index]}" == "${expected[$index]}" ]] || {
      printf 'expected entries: %s\nactual entries: %s\n' "${expected[*]}" "${actual[*]}" >&2
      fail 'distribution contains an unexpected entry'
      return 1
    }
    [[ -f "$distribution_dir/${expected[$index]}" && ! -L "$distribution_dir/${expected[$index]}" ]] || {
      fail "distribution entry is not a regular file: ${expected[$index]}"
      return 1
    }
  done

  local config_line app_line
  config_line="$(grep -nF 'src="./config.js"' "$distribution_dir/index.html" | head -n 1 | cut -d: -f1 || true)"
  app_line="$(grep -nF 'src="./app.js"' "$distribution_dir/index.html" | head -n 1 | cut -d: -f1 || true)"
  [[ -n "$config_line" && -n "$app_line" && "$config_line" -lt "$app_line" ]] || {
    fail 'index.html must load config.js before app.js'
    return 1
  }
}

check_repository_contract() {
  local repository_root="$1"
  local distribution_dir="$repository_root/webui/dist"

  check_distribution "$distribution_dir"

  [[ "$(tr -d '\r\n' < "$repository_root/webui/public/config.js")" == \
    "globalThis.SANDKASTEN_CONFIG ??= { apiBaseUrl: '' };" ]] || {
    fail 'public/config.js must preserve nullish assignment and the same-origin default'
    return 1
  }

  local distribution_file
  for distribution_file in index.html app.js styles.css config.js; do
    grep -Fxq "!webui/dist/$distribution_file" "$repository_root/.gitignore" || {
      fail ".gitignore must expose webui/dist/$distribution_file as a versioned payload"
      return 1
    }
  done

  local readme="$repository_root/webui/README.md"
  for required_text in \
    'npm ci' \
    'npm run dev' \
    'npm test' \
    'npm run build' \
    'webui/dist' \
    'globalThis.SANDKASTEN_CONFIG ??=' \
    'globalThis.SANDKASTEN_CONFIG =' \
    'SANDKASTEN_API_BASE_URL'; do
    grep -Fq "$required_text" "$readme" || {
      fail "webui/README.md must document: $required_text"
      return 1
    }
  done
}

repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

case "${1:---test}" in
  --check)
    check_distribution "${2:-}"
    printf 'webui build check: ok\n'
    ;;
  --test)
    if command -v npm >/dev/null 2>&1 && command -v node >/dev/null 2>&1; then
      (cd "$repository_root/webui" && node --test tests/build-contract.test.mjs)
    fi
    check_repository_contract "$repository_root"
    printf 'webui build tests: ok\n'
    ;;
  *)
    printf 'usage: %s --test | --check DISTRIBUTION_DIR\n' "$0" >&2
    exit 2
    ;;
esac
