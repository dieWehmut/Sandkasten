#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Keep repository checkouts on the normal modular installer path. A downloaded
# copy of this file has no sibling modules, so stage the same files remotely.
if [[ -f "${SCRIPT_DIR}/installer/entrypoint.sh" ]]; then
  exec bash "${SCRIPT_DIR}/installer/entrypoint.sh" "$@"
fi

BOOTSTRAP_BASE_URL="${SANDKASTEN_INSTALL_BASE_URL:-https://cdn.jsdelivr.net/gh/dieWehmut/sandkasten@main/werkzeug}"
BOOTSTRAP_BASE_URL="${BOOTSTRAP_BASE_URL%/}"
BOOTSTRAP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sandkasten-installer.XXXXXX")"
trap 'rm -rf "$BOOTSTRAP_DIR"' EXIT

bootstrap_download() {
  local url="$1" destination="$2"
  if [[ -n "${SANDKASTEN_INSTALL_DOWNLOADER:-}" ]]; then
    "${SANDKASTEN_INSTALL_DOWNLOADER}" "$url" "$destination"
  elif command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$destination"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$destination" "$url"
  else
    printf 'install.sh: bootstrap requires curl or wget\n' >&2
    return 127
  fi
}

bootstrap_file() {
  local relative="$1" destination="${BOOTSTRAP_DIR}/${1}"
  mkdir -p "$(dirname "$destination")"
  if ! bootstrap_download "${BOOTSTRAP_BASE_URL}/${relative}" "$destination"; then
    printf 'install.sh: failed to download %s from %s\n' "$relative" "$BOOTSTRAP_BASE_URL" >&2
    return 1
  fi
  [[ -s "$destination" ]] || {
    printf 'install.sh: downloaded file is empty: %s\n' "$relative" >&2
    return 1
  }
}

for bootstrap_file_name in \
  deploy.sh \
  uninstall.sh \
  installer/entrypoint.sh \
  installer/lib.sh \
  installer/languages.sh \
  installer/webui.sh; do
  bootstrap_file "$bootstrap_file_name"
done

# This hook lets tests validate staging with a fake downloader without invoking
# the staged installer (which may require root for non-dry-run commands).
if [[ "${SANDKASTEN_BOOTSTRAP_TEST:-0}" == 1 ]]; then
  printf 'install.sh: bootstrap complete\n'
  exit 0
fi

if [[ "${1:-}" == uninstall ]]; then
  shift
  exec bash "${BOOTSTRAP_DIR}/uninstall.sh" "$@"
fi

exec bash "${BOOTSTRAP_DIR}/installer/entrypoint.sh" "$@"
