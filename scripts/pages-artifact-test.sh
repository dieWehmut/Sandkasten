#!/usr/bin/env bash
# Keep this standalone checker runnable from WSL and GitHub's Linux runner.
set -euo pipefail

fail() {
  printf 'pages artifact test: %s\n' "$*" >&2
  return 1
}

check_artifact() {
  local artifact_dir="${1:-}"
  [[ -n "$artifact_dir" ]] || { fail 'artifact directory is required'; return 1; }
  [[ -d "$artifact_dir" ]] || { fail "artifact directory does not exist: $artifact_dir"; return 1; }

  local expected=(app.js config.js index.html styles.css)
  local actual=()
  mapfile -t actual < <(find "$artifact_dir" -mindepth 1 -type f -printf '%P\n' | LC_ALL=C sort)
  [[ "${#actual[@]}" -eq "${#expected[@]}" ]] || {
    printf 'expected files: %s\nactual files: %s\n' "${expected[*]}" "${actual[*]}" >&2
    fail 'artifact must contain exactly the four WebUI runtime files'
    return 1
  }

  local index
  for index in "${!expected[@]}"; do
    [[ "${actual[$index]}" == "${expected[$index]}" ]] || {
      printf 'expected files: %s\nactual files: %s\n' "${expected[*]}" "${actual[*]}" >&2
      fail 'artifact contains an unexpected file'
      return 1
    }
    [[ -f "$artifact_dir/${expected[$index]}" && ! -L "$artifact_dir/${expected[$index]}" ]] || \
      { fail "artifact entry is not a regular file: ${expected[$index]}"; return 1; }
  done

  if find "$artifact_dir" -mindepth 1 -type d -print -quit | grep -q .; then
    fail 'artifact must not contain nested source directories'
    return 1
  fi
  if find "$artifact_dir" -mindepth 1 -type l -print -quit | grep -q .; then
    fail 'artifact must not contain symbolic links'
    return 1
  fi

  local config_source
  config_source="$(<"$artifact_dir/config.js")"
  printf '%s\n' "$config_source" | grep -Eq \
    '^globalThis\.SANDKASTEN_CONFIG[[:space:]]*=[[:space:]]*\{[[:space:]]*apiBaseUrl:[[:space:]]*"([^"\\]|\\.)*"[[:space:]]*\};[[:space:]]*$' || \
    { fail 'config.js must define only the JSON-escaped apiBaseUrl field'; return 1; }

  local config_line app_line
  config_line="$(grep -nF 'src="./config.js"' "$artifact_dir/index.html" | head -n 1 | cut -d: -f1 || true)"
  app_line="$(grep -nF 'src="./app.js"' "$artifact_dir/index.html" | head -n 1 | cut -d: -f1 || true)"
  [[ -n "$config_line" && -n "$app_line" && "$config_line" -lt "$app_line" ]] || {
    fail 'index.html must load relative config.js before relative app.js'
    return 1
  }
  grep -Fq 'href="./styles.css"' "$artifact_dir/index.html" || {
    fail 'index.html must load relative styles.css for the /Sandkasten/ project path'
    return 1
  }
}

assert_workflow_contract() {
  local workflow="${1:-.github/workflows/pages.yml}"
  [[ -f "$workflow" ]] || { fail "workflow does not exist: $workflow"; return 1; }
  grep -Eq '^on:[[:space:]]*$' "$workflow" || { fail 'workflow must declare on'; return 1; }
  grep -Eq '^  push:[[:space:]]*$' "$workflow" || { fail 'workflow must trigger on push'; return 1; }
  grep -Eq '^    branches:[[:space:]]*$' "$workflow" || { fail 'workflow must restrict push trigger to branches'; return 1; }
  grep -Eq '^      - main[[:space:]]*$' "$workflow" || { fail 'workflow push trigger must include main'; return 1; }
  grep -Eq '^  workflow_dispatch:[[:space:]]*$' "$workflow" || { fail 'workflow must support manual dispatch'; return 1; }
  grep -Eq '^permissions:[[:space:]]*$' "$workflow" || { fail 'workflow must declare permissions'; return 1; }
  grep -Eq '^  contents:[[:space:]]*read[[:space:]]*$' "$workflow" || { fail 'workflow contents permission must be read'; return 1; }
  grep -Eq '^  pages:[[:space:]]*write[[:space:]]*$' "$workflow" || { fail 'workflow pages permission must be write'; return 1; }
  grep -Eq '^  id-token:[[:space:]]*write[[:space:]]*$' "$workflow" || { fail 'workflow id-token permission must be write'; return 1; }
  grep -Fq 'actions/configure-pages@v5' "$workflow" || { fail 'workflow must configure Pages with the official action'; return 1; }
  grep -Fq 'actions/upload-pages-artifact@v3' "$workflow" || { fail 'workflow must upload the Pages artifact with the official action'; return 1; }
  grep -Fq 'actions/deploy-pages@v4' "$workflow" || { fail 'workflow must deploy Pages with the official action'; return 1; }
  grep -Fq 'vars.SANDKASTEN_API_BASE_URL' "$workflow" || { fail 'workflow must read the repository variable'; return 1; }
  grep -Fq 'globalThis.SANDKASTEN_CONFIG' "$workflow" || { fail 'workflow must generate the runtime config contract'; return 1; }
  grep -Fq 'actions/setup-node@v4' "$workflow" || { fail 'workflow must set up Node.js'; return 1; }
  grep -Fq 'node-version: 22.18.0' "$workflow" || { fail 'workflow must pin the tested Node.js release'; return 1; }
  grep -Fq 'cache-dependency-path: webui/package-lock.json' "$workflow" || { fail 'workflow must cache from webui/package-lock.json'; return 1; }
  grep -Fq 'npm ci' "$workflow" || { fail 'workflow must install from package-lock'; return 1; }
  grep -Fq 'npm test' "$workflow" || { fail 'workflow must test the WebUI'; return 1; }
  grep -Fq 'npm run build' "$workflow" || { fail 'workflow must build the WebUI'; return 1; }
  grep -Fq 'SANDKASTEN_BUILD_ALREADY_RUN=1 bash scripts/webui-build-test.sh --test' "$workflow" || { fail 'workflow must validate the built distribution contract'; return 1; }
  grep -Fq 'cp -R webui/dist/. _site/' "$workflow" || { fail 'workflow must stage the complete built WebUI before config generation'; return 1; }
  grep -Fq "API_BASE_URL=\"\$API_BASE_URL\" python3 - <<'PY' > _site/config.js" "$workflow" || { fail 'workflow must generate config.js from the environment'; return 1; }
  grep -Fq 'os.environ.get("API_BASE_URL", "")' "$workflow" || { fail 'workflow must treat an unset API variable as empty'; return 1; }
  grep -Fq 'json.dumps' "$workflow" || { fail 'workflow must JSON-escape the API base URL'; return 1; }
  grep -Fq 'scripts/pages-artifact-test.sh --check _site' "$workflow" || { fail 'workflow must validate the staged artifact'; return 1; }
  if grep -Fq 'secrets.' "$workflow"; then
    fail 'workflow must not embed secrets in the public artifact'
    return 1
  fi
}

run_tests() {
  local repo_root
  repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
  assert_workflow_contract "$repo_root/.github/workflows/pages.yml"

  tmp_dir="$(mktemp -d)"
  trap 'rm -rf -- "${tmp_dir:-}"' EXIT
  printf '%s\n' \
    '<script src="./config.js"></script>' \
    '<script type="module" src="./app.js"></script>' \
    '<link rel="stylesheet" href="./styles.css">' > "$tmp_dir/index.html"
  for file in app.js styles.css; do
    printf '%s\n' "$file" > "$tmp_dir/$file"
  done
  printf 'globalThis.SANDKASTEN_CONFIG = { apiBaseUrl: "" };\n' > "$tmp_dir/config.js"
  check_artifact "$tmp_dir"

  printf 'globalThis.SANDKASTEN_CONFIG = { apiBaseUrl: "https://example.test/a\\\"b" };\n' > "$tmp_dir/config.js"
  check_artifact "$tmp_dir"
  printf 'globalThis.SANDKASTEN_CONFIG = { apiBaseUrl: "" };\n' > "$tmp_dir/config.js"

  printf '%s\n' \
    '<script type="module" src="./app.js"></script>' \
    '<script src="./config.js"></script>' \
    '<link rel="stylesheet" href="./styles.css">' > "$tmp_dir/index.html"
  if check_artifact "$tmp_dir" >/dev/null 2>&1; then
    fail 'artifact checker accepted app.js before config.js'
  fi
  printf '%s\n' \
    '<script src="./config.js"></script>' \
    '<script type="module" src="./app.js"></script>' \
    '<link rel="stylesheet" href="./styles.css">' > "$tmp_dir/index.html"

  printf 'source documentation must not ship\n' > "$tmp_dir/README.md"
  if check_artifact "$tmp_dir" >/dev/null 2>&1; then
    fail 'artifact checker accepted README.md'
  fi
  rm -f "$tmp_dir/README.md"

  mkdir "$tmp_dir/test"
  printf 'source test must not ship\n' > "$tmp_dir/test/test.mjs"
  if check_artifact "$tmp_dir" >/dev/null 2>&1; then
    fail 'artifact checker accepted a nested source test'
  fi

  rm -rf "$tmp_dir/test"
  ln -s app.js "$tmp_dir/linked-app.js"
  if check_artifact "$tmp_dir" >/dev/null 2>&1; then
    fail 'artifact checker accepted a symbolic link'
  fi
  rm -f "$tmp_dir/linked-app.js"

  printf 'globalThis.SANDKASTEN_CONFIG = { apiBaseUrl: 42 };\n' > "$tmp_dir/config.js"
  if check_artifact "$tmp_dir" >/dev/null 2>&1; then
    fail 'artifact checker accepted a non-string apiBaseUrl'
  fi

  printf 'pages artifact tests: ok\n'
}

case "${1:---test}" in
  --check)
    check_artifact "${2:-}"
    printf 'pages artifact check: ok\n'
    ;;
  --test)
    run_tests
    ;;
  *)
    printf 'usage: %s --test | --check ARTIFACT_DIR\n' "$0" >&2
    exit 2
    ;;
esac
