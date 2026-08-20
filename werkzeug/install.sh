#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Keep repository checkouts on the normal modular installer path. A downloaded
# copy of this file has no sibling modules, so stage the same files remotely.
if [[ -f "${SCRIPT_DIR}/installer/entrypoint.sh" ]]; then
  exec bash "${SCRIPT_DIR}/installer/entrypoint.sh" "$@"
fi

BOOTSTRAP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sandkasten-installer.XXXXXX")"
trap 'rm -rf "$BOOTSTRAP_DIR"' EXIT
BOOTSTRAP_FILES=(
  deploy.sh
  uninstall.sh
  installer/entrypoint.sh
  installer/lib.sh
  installer/languages.sh
  installer/webui.sh
)

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

bootstrap_archive() {
  local url="$1" archive="${BOOTSTRAP_DIR}/repository.tar.gz"
  local members roots archive_root relative member count listing destination
  command -v tar >/dev/null 2>&1 || {
    printf 'install.sh: archive bootstrap requires tar with gzip support\n' >&2
    return 127
  }
  if ! bootstrap_download "$url" "$archive"; then
    printf 'install.sh: failed to download repository snapshot from %s\n' "$url" >&2
    return 1
  fi
  [[ -s "$archive" ]] || {
    printf 'install.sh: downloaded repository snapshot is empty\n' >&2
    return 1
  }
  if ! members="$(tar -tzf "$archive" 2>/dev/null)"; then
    printf 'install.sh: downloaded repository snapshot is not a valid tar.gz archive\n' >&2
    return 1
  fi
  roots="$(printf '%s\n' "$members" | awk -F/ 'NF { print $1 }' | sort -u)"
  if [[ -z "$roots" || "$roots" == *$'\n'* || ! "$roots" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
    printf 'install.sh: repository snapshot must contain one safe top-level directory\n' >&2
    return 1
  fi
  archive_root="$roots"

  for relative in "${BOOTSTRAP_FILES[@]}"; do
    member="${archive_root}/werkzeug/${relative}"
    count="$(printf '%s\n' "$members" | awk -v wanted="$member" '$0 == wanted { count++ } END { print count + 0 }')"
    [[ "$count" == 1 ]] || {
      printf 'install.sh: repository snapshot must contain exactly one %s\n' "$member" >&2
      return 1
    }
    if ! listing="$(tar -tvzf "$archive" -- "$member" 2>/dev/null)" || [[ "${listing:0:1}" != - ]]; then
      printf 'install.sh: repository snapshot member is not a regular file: %s\n' "$member" >&2
      return 1
    fi
    destination="${BOOTSTRAP_DIR}/${relative}"
    mkdir -p "$(dirname "$destination")"
    if ! tar -xOzf "$archive" -- "$member" > "$destination" || [[ ! -s "$destination" ]]; then
      printf 'install.sh: failed to extract non-empty snapshot member: %s\n' "$member" >&2
      return 1
    fi
  done
  rm -f "$archive"
}

if [[ -n "${SANDKASTEN_INSTALL_BASE_URL:-}" ]]; then
  BOOTSTRAP_BASE_URL="${SANDKASTEN_INSTALL_BASE_URL%/}"
  for bootstrap_file_name in "${BOOTSTRAP_FILES[@]}"; do
    bootstrap_file "$bootstrap_file_name"
  done
else
  BOOTSTRAP_ARCHIVE_URL="${SANDKASTEN_INSTALL_ARCHIVE_URL:-https://codeload.github.com/dieWehmut/sandkasten/tar.gz/refs/heads/main}"
  bootstrap_archive "$BOOTSTRAP_ARCHIVE_URL"
fi

# This hook lets tests validate staging with a fake downloader without invoking
# the staged installer (which may require root for non-dry-run commands).
if [[ "${SANDKASTEN_BOOTSTRAP_TEST:-0}" == 1 ]]; then
  printf 'install.sh: bootstrap complete\n'
  exit 0
fi

bash "${BOOTSTRAP_DIR}/installer/entrypoint.sh" "$@"
