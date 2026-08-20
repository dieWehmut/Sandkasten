#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT/einsatz/docker-compose.dev.yaml"
profiles=()
migrate=1

usage() {
  cat <<'EOF'
Usage: ./werkzeug/development/dev-up.sh [--with-api] [--with-runner] [--skip-migrate]

Starts the local Docker Compose development stack. By default this starts only
Postgres and applies speicher/schema.sql. API and runner images are opt-in
because they require generated protobuf bindings and the runner binary source.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-api)
      profiles+=(--profile api)
      ;;
    --with-runner)
      profiles+=(--profile runner)
      ;;
    --skip-migrate)
      migrate=0
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if ! command -v docker >/dev/null 2>&1; then
  printf 'missing required tool: docker\nInstall Docker with the Compose plugin, then rerun this script.\n' >&2
  exit 127
fi

if ! docker compose version >/dev/null 2>&1; then
  printf 'missing required tool: docker compose\nInstall the Docker Compose plugin, then rerun this script.\n' >&2
  exit 127
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  printf 'missing compose file: %s\n' "$COMPOSE_FILE" >&2
  exit 1
fi

printf 'Starting Sandkasten development services...\n'
docker compose -f "$COMPOSE_FILE" "${profiles[@]}" up -d postgres

if [[ "$migrate" -eq 1 ]]; then
  if [[ ! -f "$ROOT/speicher/schema.sql" ]]; then
    printf 'missing speicher/schema.sql; skipping database schema load\n' >&2
  else
    printf 'Waiting for Postgres readiness...\n'
    for _ in {1..60}; do
      if docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U sandkasten -d sandkasten >/dev/null 2>&1; then
        break
      fi
      sleep 1
    done
    if ! docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U sandkasten -d sandkasten >/dev/null 2>&1; then
      printf 'Postgres did not become ready in time\n' >&2
      exit 1
    fi
    docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U sandkasten -d sandkasten < "$ROOT/speicher/schema.sql"
  fi
fi

if [[ "${#profiles[@]}" -gt 0 ]]; then
  docker compose -f "$COMPOSE_FILE" "${profiles[@]}" up -d
fi

cat <<EOF
Development stack is up.

Postgres: localhost:5432
Database URL: postgres://sandkasten:sandkasten@localhost:5432/sandkasten?sslmode=disable
API gRPC: localhost:50051 when started with --with-api
EOF
