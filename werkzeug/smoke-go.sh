#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="/usr/local/go/bin:$PATH:/usr/local/bin:/usr/bin:/bin"

DB_URL="${DATABASE_URL:-postgres://sandkasten:sandkasten@localhost:5432/sandkasten?sslmode=disable}"
API_ADDR="${SANDKASTEN_ADDR:-127.0.0.1:50051}"
HTTP_ADDR="${SANDKASTEN_HTTP_ADDR:-127.0.0.1:8080}"
API_TOKEN="${SANDKASTEN_API_TOKEN:-dev-token}"
RUNNER_WORK_DIR="${LAEUFER_WORK_DIR:-/tmp/sandkasten-laeufer-smoke}"
COMPILE_MEMORY_LIMIT_BYTES="${LAEUFER_COMPILE_MEMORY_LIMIT_BYTES:-1073741824}"
RUNTIME_PATH="${LAEUFER_RUNTIME_PATH:-/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin}"

api_pid=""
runner_pid=""

cleanup() {
  if [[ -n "$runner_pid" ]] && kill -0 "$runner_pid" >/dev/null 2>&1; then
    kill "$runner_pid" >/dev/null 2>&1 || true
    wait "$runner_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$api_pid" ]] && kill -0 "$api_pid" >/dev/null 2>&1; then
    kill "$api_pid" >/dev/null 2>&1 || true
    wait "$api_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

need_tool() {
  local name="$1"
  local hint="$2"
  if ! command -v "$name" >/dev/null 2>&1; then
    printf 'missing required tool: %s\n%s\n' "$name" "$hint" >&2
    exit 127
  fi
}

need_runtime_tool() {
  local name="$1"
  local hint="$2"
  if ! PATH="$RUNTIME_PATH" command -v "$name" >/dev/null 2>&1; then
    printf 'missing runtime tool in LAEUFER_RUNTIME_PATH: %s\n%s\nruntime path: %s\n' "$name" "$hint" "$RUNTIME_PATH" >&2
    exit 127
  fi
}

need_tool go "Install Go 1.25+ for the API module."
need_tool cargo "Install Rust/Cargo for the runner."
need_tool grpcurl "Install grpcurl or run: go install github.com/fullstorydev/grpcurl/cmd/grpcurl@latest"
need_tool curl "Install curl to exercise the HTTP API."
need_tool jq "Install jq to parse smoke-test responses."
need_tool psql "Install postgresql-client."
need_runtime_tool go "Install Go 1.25+ where the runner child PATH can execute it."

printf 'Checking database connectivity...\n'
psql "$DB_URL" -v ON_ERROR_STOP=1 -c 'select 1' >/dev/null

printf 'Loading schema...\n'
psql "$DB_URL" -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
DROP TABLE IF EXISTS job_events CASCADE;
DROP TABLE IF EXISTS job_artifacts CASCADE;
DROP TABLE IF EXISTS job_attempts CASCADE;
DROP TABLE IF EXISTS jobs CASCADE;
DROP TYPE IF EXISTS job_status CASCADE;
SQL
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$ROOT/speicher/schema.sql" >/dev/null
psql "$DB_URL" -v ON_ERROR_STOP=1 -c 'truncate job_events, job_artifacts, job_attempts, jobs restart identity cascade;' >/dev/null

printf 'Building API and runner...\n'
(cd "$ROOT/schnittstelle" && go build -trimpath -o /tmp/sandkasten-api-smoke ./cmd/sandkasten-api)
(cd "$ROOT/laeufer" && cargo build --bin laeufer >/dev/null)

printf 'Starting API on %s...\n' "$API_ADDR"
DATABASE_URL="$DB_URL" \
SANDKASTEN_API_TOKEN="$API_TOKEN" \
SANDKASTEN_API_GRPC_ADDR="$API_ADDR" \
SANDKASTEN_API_HTTP_ADDR="$HTTP_ADDR" \
SANDKASTEN_API_CORS_ORIGINS="http://localhost:5173,http://127.0.0.1:5173,https://diewehmut.github.io" \
  /tmp/sandkasten-api-smoke >/tmp/sandkasten-api-smoke.log 2>&1 &
api_pid="$!"

for _ in {1..50}; do
  if grpcurl -plaintext \
    -H "authorization: Bearer ${API_TOKEN}" \
    -import-path "$ROOT/vertrag" \
    -proto sandkasten/v1/runtime.proto \
    "$API_ADDR" \
    sandkasten.v1.RuntimeService/ListRuntimes >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

if ! grpcurl -plaintext \
  -H "authorization: Bearer ${API_TOKEN}" \
  -import-path "$ROOT/vertrag" \
  -proto sandkasten/v1/runtime.proto \
  "$API_ADDR" \
  sandkasten.v1.RuntimeService/ListRuntimes >/dev/null 2>&1; then
  printf 'API did not become ready; log follows:\n' >&2
  cat /tmp/sandkasten-api-smoke.log >&2
  exit 1
fi

printf 'Starting runner...\n'
rm -rf "$RUNNER_WORK_DIR"
DATABASE_URL="$DB_URL" \
LAEUFER_RUNNER_ID=smoke-go \
LAEUFER_WORK_DIR="$RUNNER_WORK_DIR" \
LAEUFER_POLL_INTERVAL_MS=200 \
LAEUFER_LEASE_TTL_MS=60000 \
LAEUFER_CGROUP_ROOT="${LAEUFER_CGROUP_ROOT:-/sys/fs/cgroup}" \
LAEUFER_REQUIRE_PRIVATE_NAMESPACES="${LAEUFER_REQUIRE_PRIVATE_NAMESPACES:-1}" \
LAEUFER_COMPILE_MEMORY_LIMIT_BYTES="$COMPILE_MEMORY_LIMIT_BYTES" \
LAEUFER_RUNTIME_PATH="$RUNTIME_PATH" \
LAEUFER_CHILD_UID="${LAEUFER_CHILD_UID:-65534}" \
LAEUFER_CHILD_GID="${LAEUFER_CHILD_GID:-65534}" \
  "$ROOT/laeufer/target/debug/laeufer" >/tmp/sandkasten-runner-smoke.log 2>&1 &
runner_pid="$!"

sleep 1
if ! kill -0 "$runner_pid" >/dev/null 2>&1; then
  printf 'runner exited during startup; log follows:\n' >&2
  cat /tmp/sandkasten-runner-smoke.log >&2
  exit 1
fi

printf 'Submitting Go example...\n'
submit_json="$(
  SANDKASTEN_ADDR="$API_ADDR" \
  SANDKASTEN_API_TOKEN="$API_TOKEN" \
  "$ROOT/beispiele/grpc-client/submit-go-project.sh" "$ROOT/beispiele/go-hello"
)"
job_id="$(jq -r '.jobId' <<<"$submit_json")"
if [[ -z "$job_id" || "$job_id" == "null" ]]; then
  printf 'submit response did not contain jobId: %s\n' "$submit_json" >&2
  exit 1
fi

printf 'Waiting for job %s...\n' "$job_id"
terminal_status=""
for _ in {1..120}; do
  terminal_status="$(psql "$DB_URL" -At -c "select status::text from jobs where job_id = '${job_id}'::uuid")"
  case "$terminal_status" in
    SUCCEEDED|COMPILE_FAILED|RUNTIME_FAILED|TIME_LIMIT_EXCEEDED|MEMORY_LIMIT_EXCEEDED|OUTPUT_LIMIT_EXCEEDED|CANCELED|SYSTEM_ERROR)
      break
      ;;
  esac
  sleep 0.5
done

job_json="$(
  grpcurl -plaintext \
    -H "authorization: Bearer ${API_TOKEN}" \
    -import-path "$ROOT/vertrag" \
    -proto sandkasten/v1/jobs.proto \
    -d "{\"jobId\":\"${job_id}\"}" \
    "$API_ADDR" \
    sandkasten.v1.JobService/GetJob
)"

status="$(jq -r '.status' <<<"$job_json")"
stdout_b64="$(jq -r '.result.stdout // ""' <<<"$job_json")"
expected_stdout_b64="$(printf 'hello, Sandkasten\n' | base64 | tr -d '\n')"

if [[ "$status" != "JOB_STATUS_SUCCEEDED" || "$stdout_b64" != "$expected_stdout_b64" ]]; then
  stdout="$(printf '%s' "$stdout_b64" | base64 -d 2>/dev/null || true)"
  printf 'smoke failed\nstatus: %s\nstdout: %q\njob: %s\n' "$status" "$stdout" "$job_json" >&2
  printf 'runner log:\n' >&2
  cat /tmp/sandkasten-runner-smoke.log >&2
  exit 1
fi

printf 'gRPC smoke passed: %s -> hello, Sandkasten\n' "$job_id"

printf 'Submitting Go example through HTTP API...\n'
http_json="$(
  curl -fsS \
    -H "authorization: Bearer ${API_TOKEN}" \
    -H 'content-type: application/json' \
    -H 'origin: http://localhost:5173' \
    -d '{"source":"package main\nimport \"fmt\"\nfunc main(){fmt.Println(\"hello, Sandkasten\")}\n","wait":true,"waitTimeoutMs":30000}' \
    "http://${HTTP_ADDR}/v1/go/run"
)"
http_status="$(jq -r '.status' <<<"$http_json")"
http_stdout="$(jq -r '.stdout' <<<"$http_json")"
if [[ "$http_status" != "JOB_STATUS_SUCCEEDED" || "$http_stdout" != "hello, Sandkasten" ]]; then
  printf 'http smoke failed\nstatus: %s\nstdout: %q\njob: %s\n' "$http_status" "$http_stdout" "$http_json" >&2
  printf 'runner log:\n' >&2
  cat /tmp/sandkasten-runner-smoke.log >&2
  exit 1
fi

printf 'HTTP smoke passed: %s -> hello, Sandkasten\n' "$(jq -r '.jobId' <<<"$http_json")"

printf 'Submitting Sandkasten API Go smoke with timing...\n'
api_source="$(cat <<'GO'
package main

import (
  "encoding/json"
  "fmt"
  "os"
  "strings"
)

func main() {
  seed, err := os.ReadFile("test.txt")
  if err != nil {
    panic(err)
  }
  if err := os.WriteFile("user_info.txt", []byte("name=Alice\n"), 0644); err != nil {
    panic(err)
  }
  written, err := os.ReadFile("user_info.txt")
  if err != nil {
    panic(err)
  }
  data, err := json.Marshal(map[string]string{
    "runner": "sandkasten",
    "seed": strings.TrimSpace(string(seed)),
    "written": strings.TrimSpace(string(written)),
  })
  if err != nil {
    panic(err)
  }
  fmt.Printf("sandkasten-smoke %s\n", data)
}
GO
)"
api_payload="$(jq -nc --arg source "$api_source" --arg test_file $'file-smoke\n' '{source:$source,files:[{name:"test.txt",content:$test_file}],wait:true,waitTimeoutMs:30000}')"
api_start_ms="$(date +%s%3N)"
api_json="$(
  curl -fsS \
    -H "authorization: Bearer ${API_TOKEN}" \
    -H 'content-type: application/json' \
    -H 'origin: http://localhost:5173' \
    -d "$api_payload" \
    "http://${HTTP_ADDR}/v1/go/run"
)"
api_elapsed_ms="$(( $(date +%s%3N) - api_start_ms ))"
api_status="$(jq -r '.status' <<<"$api_json")"
api_stdout="$(jq -r '.stdout' <<<"$api_json")"
if [[ "$api_status" != "JOB_STATUS_SUCCEEDED" || "$api_stdout" != 'sandkasten-smoke {"runner":"sandkasten","seed":"file-smoke","written":"name=Alice"}' ]]; then
  printf 'Sandkasten API go smoke failed\nstatus: %s\nstdout: %q\njob: %s\n' "$api_status" "$api_stdout" "$api_json" >&2
  printf 'runner log:\n' >&2
  cat /tmp/sandkasten-runner-smoke.log >&2
  exit 1
fi

printf 'Sandkasten API Go smoke passed in %s ms: %s\n' "$api_elapsed_ms" "$(jq -r '.jobId' <<<"$api_json")"
