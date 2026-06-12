#!/usr/bin/env bash
set -Eeuo pipefail

DRY_RUN="${DRY_RUN:-0}"
PRUNE_BUILDKIT_ALL="${PRUNE_BUILDKIT_ALL:-0}"
PRUNE_UNTIL="${PRUNE_UNTIL:-24h}"

run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '+ %q' "$1"
    shift
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  "$@"
}

if ! command -v docker >/dev/null 2>&1; then
  printf 'missing docker CLI\n' >&2
  exit 127
fi

printf 'Current Docker disk usage:\n'
docker system df || true

mapfile -t sandkasten_images < <(
  docker images --format '{{.Repository}} {{.Tag}} {{.ID}}' |
    awk '$1 ~ /^sandkasten-/ && $2 != "dev" { print $3 }' |
    sort -u
)

if [[ "${#sandkasten_images[@]}" -gt 0 ]]; then
  printf 'Removing non-dev Sandkasten images: %s\n' "${sandkasten_images[*]}"
  run docker image rm "${sandkasten_images[@]}" || true
else
  printf 'No non-dev Sandkasten images to remove\n'
fi

printf 'Pruning dangling images...\n'
run docker image prune -f --filter "dangling=true"

if [[ "$PRUNE_BUILDKIT_ALL" == "1" ]]; then
  printf 'Pruning all unused BuildKit cache...\n'
  run docker builder prune -f
else
  printf 'Pruning BuildKit cache older than %s...\n' "$PRUNE_UNTIL"
  run docker builder prune -f --filter "until=$PRUNE_UNTIL"
fi

printf 'Docker cleanup complete\n'
