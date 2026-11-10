#!/usr/bin/env bash
# The workflow owns an isolated Postgres service and emulator. This script runs
# the production API and Linux sandbox, then operates the installed debug APK.
set -Eeuo pipefail

task_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
evidence="$task_root/.sandkasten/mobile-ci/evidence"
apk_dir="$task_root/.sandkasten/mobile-ci/apks"
runner_cgroup_root=/sys/fs/cgroup/sandkasten-mobile-ci
api_pid=""
runner_pid=""
mkdir -p "$evidence"
export MOBILE_E2E_OUTPUT="$evidence/native"
: "${DATABASE_URL:?The isolated workflow Postgres URL is required}"
: "${SANDKASTEN_API_TOKEN:?The workflow test token is required}"
: "${MOBILE_E2E_DEVICE:?An isolated test emulator is required}"

collect_and_stop() {
  task_status=$?
  trap - EXIT
  set +e
  adb -s "$MOBILE_E2E_DEVICE" logcat -d >"$evidence/android-logcat.txt" 2>&1
  adb -s "$MOBILE_E2E_DEVICE" shell dumpsys package dev.sandkasten.mobile >"$evidence/installed-package.txt" 2>&1
  psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 -c "
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'jobId', j.job_id, 'status', j.status, 'startedAt', j.started_at,
      'finishedAt', j.finished_at, 'errorMessage', j.error_message,
      'artifactPresent', a.job_id IS NOT NULL,
      'stdoutBase64', encode(a.stdout, 'base64'),
      'compileStderrBase64', encode(a.compile_stderr, 'base64'),
      'durationMs', a.wall_time_ms)), '[]'::jsonb)
    FROM jobs j LEFT JOIN job_artifacts a ON a.job_id = j.job_id;
  " >"$evidence/jobs.json" 2>"$evidence/database-diagnostics.log"
  if [[ -n "$api_pid" ]]; then kill "$api_pid" 2>/dev/null; fi
  if [[ -n "$runner_pid" ]]; then
    sudo -n kill -TERM "$runner_pid" 2>/dev/null
    for _ in {1..25}; do
      sudo -n kill -0 "$runner_pid" 2>/dev/null || break
      sleep 0.2
    done
    sudo -n kill -KILL "$runner_pid" 2>/dev/null
  fi
  # Only the dedicated workflow cgroup contains our sandbox children.
  if [[ -e "$runner_cgroup_root/cgroup.kill" ]]; then
    printf '1' | sudo -n tee "$runner_cgroup_root/cgroup.kill" >/dev/null
  fi
  sudo -n find "$runner_cgroup_root" -depth -mindepth 1 -type d -exec rmdir {} \; 2>/dev/null
  sudo -n rmdir "$runner_cgroup_root" 2>/dev/null
  printf '%s\n' "$task_status" >"$evidence/exit-status.txt"
  exit "$task_status"
}
trap collect_and_stop EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$task_root/speicher/schema.sql" >"$evidence/database-schema.log" 2>&1
sha256sum "$apk_dir/app-debug.apk" "$apk_dir/app-debug-androidTest.apk" >"$evidence/apk-sha256.txt"
git -C "$task_root" rev-parse HEAD >"$evidence/source-commit.txt"
adb -s "$MOBILE_E2E_DEVICE" shell getprop ro.build.version.sdk >"$evidence/android-api.txt"

sudo -n sh -c 'printf "+cpu +memory +pids" > /sys/fs/cgroup/cgroup.subtree_control'
sudo -n mkdir -p "$runner_cgroup_root"
# Controllers must propagate through this dedicated parent before the runner
# creates its own nested cgroups and writes their memory/cpu/pids limits.
sudo -n sh -c 'printf "+cpu +memory +pids" > "$1/cgroup.subtree_control"' sh "$runner_cgroup_root"
cat "$runner_cgroup_root/cgroup.controllers" >"$evidence/cgroup-controllers.txt"
sudo -n sh -c 'id; uname -a; sed -n "/^Cap/p" /proc/self/status; cat /sys/fs/cgroup/cgroup.controllers; cat /sys/fs/cgroup/cgroup.subtree_control' \
  >"$evidence/privileged-environment.txt" 2>&1
cat "$runner_cgroup_root/cgroup.subtree_control" >>"$evidence/privileged-environment.txt"
go_executable="$(command -v go)"
runtime_path="$(dirname -- "$go_executable"):/usr/local/bin:/usr/bin:/bin"
# Sandbox children drop to nobody and must traverse the parent work directory.
sudo -n install -d -m 0755 /tmp/sandkasten-mobile-native-ci
sudo -n -u '#65534' -g '#65534' env PATH="$runtime_path" bash -euc '
  test -x /tmp/sandkasten-mobile-native-ci
  go version
  python3 --version
' >"$evidence/child-runtime-access.txt" 2>&1

security_test_executable="$(cat "$evidence/security-test-executable.txt")"
test -x "$security_test_executable"
sudo -n env LAEUFER_SECURITY_CGROUP_ROOT="$runner_cgroup_root" \
  timeout --signal=TERM --kill-after=5s 60s "$security_test_executable" \
  --exact cancellation_preserves_output_statistics_and_kills_descendants \
  --ignored --nocapture --test-threads=1 2>&1 | tee "$evidence/privileged-test.log"
grep -Eq '^test result: ok\. 1 passed; 0 failed; 0 ignored;' "$evidence/privileged-test.log"

"$task_root/.sandkasten/mobile-ci/sandkasten-api" >"$evidence/api.log" 2>&1 &
api_pid=$!
sudo -n env \
  DATABASE_URL="$DATABASE_URL" \
  LAEUFER_RUNNER_ID=android-native-ci \
  LAEUFER_WORK_DIR=/tmp/sandkasten-mobile-native-ci \
  LAEUFER_POLL_INTERVAL_MS=200 \
  LAEUFER_MAX_CONCURRENT_JOBS=2 \
  LAEUFER_COMPILE_MEMORY_LIMIT_BYTES=1073741824 \
  LAEUFER_RUNTIME_PATH="$runtime_path" \
  LAEUFER_CGROUP_ROOT="$runner_cgroup_root" \
  LAEUFER_REQUIRE_PRIVATE_NAMESPACES=1 \
  LAEUFER_CHILD_UID=65534 \
  LAEUFER_CHILD_GID=65534 \
  bash -euc 'printf "%s\n" "$$" > "$1"; exec "$2"' bash \
  "$evidence/runner.pid" "$task_root/laeufer/target/debug/laeufer" >"$evidence/runner.log" 2>&1 &
runner_launcher=$!
for _ in {1..150}; do
  kill -0 "$api_pid" || { cat "$evidence/api.log"; exit 1; }
  kill -0 "$runner_launcher" || { cat "$evidence/runner.log"; exit 1; }
  if [[ -f "$evidence/runner.pid" ]]; then runner_pid="$(cat "$evidence/runner.pid")"; fi
  if grep -q 'started; polling' "$evidence/runner.log" &&
      curl --fail --silent --max-time 2 -H "Authorization: Bearer $SANDKASTEN_API_TOKEN" -H 'Accept: application/json' \
      http://127.0.0.1:18080/v1/runtimes >"$evidence/runtimes.json"; then break; fi
  sleep 0.2
done
[[ "$runner_pid" =~ ^[0-9]+$ ]]
grep -q 'started; polling' "$evidence/runner.log"
curl --fail --silent --max-time 5 -H "Authorization: Bearer $SANDKASTEN_API_TOKEN" -H 'Accept: application/json' \
  http://127.0.0.1:18080/v1/runtimes >"$evidence/runtimes.json"

adb -s "$MOBILE_E2E_DEVICE" logcat -c
adb -s "$MOBILE_E2E_DEVICE" install -r "$apk_dir/app-debug.apk"
adb -s "$MOBILE_E2E_DEVICE" install -r -t "$apk_dir/app-debug-androidTest.apk"
adb -s "$MOBILE_E2E_DEVICE" shell am instrument -w \
  dev.sandkasten.mobile.test/androidx.test.runner.AndroidJUnitRunner | tee "$evidence/instrumentation.txt"
# am instrument may return exit 0 even when a JUnit assertion failed.
grep -Eq '^OK \(4 tests\)[[:space:]]*$' "$evidence/instrumentation.txt"
if grep -Eq 'FAILURES!!!|INSTRUMENTATION_FAILED|shortMsg=' "$evidence/instrumentation.txt"; then exit 1; fi

(cd "$task_root/apps/mobile" && npm run test:android-e2e) 2>&1 | tee "$evidence/native-e2e.log"
node --input-type=module - "$evidence" <<'JS'
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const dir = process.argv[2];
const native = JSON.parse(await readFile(path.join(dir, 'native/results.json'), 'utf8'));
assert.equal(native.passed, true);
assert.ok(native.checks.length >= 4);
const jobs = [];
for (const check of native.checks.filter(item => item.jobId)) {
  const response = await fetch(`http://127.0.0.1:18080/v1/jobs/${encodeURIComponent(check.jobId)}`, {
    headers: { Authorization: `Bearer ${process.env.SANDKASTEN_API_TOKEN}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200);
  const job = await response.json();
  assert.equal(job.outputReady, true);
  jobs.push(job);
}
assert.ok(jobs.some(job => job.status === 'JOB_STATUS_SUCCEEDED' && job.stdout.includes('mobile input|arg-value|file-value')));
assert.ok(jobs.some(job => job.status === 'JOB_STATUS_COMPILE_FAILED' && job.compileStderr.trim()));
assert.ok(jobs.some(job => job.status === 'JOB_STATUS_CANCELED' && job.stdout.includes('before stop') && !job.stdout.includes('must not run')));
await writeFile(path.join(dir, 'verified-api-jobs.json'), JSON.stringify(jobs, null, 2));
JS
