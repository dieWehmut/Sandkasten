#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROJECT_DIR="${1:-$ROOT/beispiele/go-hello}"
ADDR="${SANDKASTEN_ADDR:-localhost:50051}"
TOKEN="${SANDKASTEN_API_TOKEN:-}"
ENTRYPOINT="${SANDKASTEN_ENTRYPOINT:-.}"

need_tool() {
  local name="$1"
  local hint="$2"
  if ! command -v "$name" >/dev/null 2>&1; then
    printf 'missing required tool: %s\n%s\n' "$name" "$hint" >&2
    exit 127
  fi
}

need_tool tar "Install tar to package the Go project."
need_tool base64 "Install coreutils or another base64 implementation."
need_tool grpcurl "Install grpcurl: https://github.com/fullstorydev/grpcurl"

if [[ ! -d "$PROJECT_DIR" ]]; then
  printf 'project directory does not exist: %s\n' "$PROJECT_DIR" >&2
  exit 1
fi

if [[ ! -f "$PROJECT_DIR/go.mod" ]]; then
  printf 'project is missing go.mod: %s\n' "$PROJECT_DIR" >&2
  exit 1
fi

if [[ ! -d "$PROJECT_DIR/vendor" ]]; then
  printf 'project is missing vendor/: %s\n' "$PROJECT_DIR" >&2
  exit 1
fi

archive="$(mktemp -t sandkasten-go-project.XXXXXX.tar.gz)"
cleanup() {
  rm -f "$archive"
}
trap cleanup EXIT

tar -C "$PROJECT_DIR" -czf "$archive" .
payload="$(base64 < "$archive" | tr -d '\n')"

headers=()
if [[ -n "$TOKEN" ]]; then
  headers=(-H "authorization: Bearer $TOKEN")
fi

grpcurl -plaintext \
  "${headers[@]}" \
  -import-path "$ROOT/vertrag" \
  -proto sandkasten/v1/jobs.proto \
  -d "{\"archiveTargz\":\"${payload}\",\"entrypoint\":\"${ENTRYPOINT}\"}" \
  "$ADDR" \
  sandkasten.v1.JobService/SubmitGoProject
