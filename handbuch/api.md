# API

The gRPC contracts live under `vertrag/sandkasten/v1`. Generate client/server bindings with:

```sh
./werkzeug/gen-proto.sh
```

## Services

`sandkasten.v1.JobService`

- `SubmitGoProject(SubmitGoProjectRequest) returns (SubmitGoProjectResponse)`
- `GetJob(GetJobRequest) returns (Job)`
- `StreamJobEvents(StreamJobEventsRequest) returns (stream JobEvent)`
- `CancelJob(CancelJobRequest) returns (CancelJobResponse)`

`sandkasten.v1.RuntimeService`

- `ListRuntimes(ListRuntimesRequest) returns (ListRuntimesResponse)`

`ListRuntimes` returns a runtime manifest for each configured language. Each entry includes `language`, `version`, `image`, `requires_vendor`, normalized `aliases`, `status`, `default_entrypoint`, `compile_phase`, `run_phase`, `default_limits`, and `max_limits`. The current service emits active runtimes; archived/deprecated runtime lifecycle states are reserved for future registry data.

## Authentication

Set `SANDKASTEN_API_TOKEN` on the API to require client credentials. When the token is empty, the API accepts unauthenticated requests.

Clients may authenticate with either metadata key:

- `authorization: Bearer <token>`
- `x-sandkasten-token: <token>`

## Submit Defaults

If omitted, the API applies these v1 defaults:

- `language`: `go`
- `entrypoint`: language-specific default
- `compile_timeout_ms`: `30000`
- `run_timeout_ms`: `5000`
- `memory_limit_bytes`: `268435456`
- `cpu_millis`: `1000`
- `max_output_bytes`: `1048576`

These defaults can be overridden globally:

- `SANDKASTEN_DEFAULT_COMPILE_TIMEOUT_MS`
- `SANDKASTEN_DEFAULT_RUN_TIMEOUT_MS`
- `SANDKASTEN_DEFAULT_MEMORY_LIMIT_BYTES`
- `SANDKASTEN_DEFAULT_CPU_MILLIS`
- `SANDKASTEN_DEFAULT_OUTPUT_BYTES`

Each supported runtime can also override these defaults with `SANDKASTEN_<LANG>_DEFAULT_*`, for example `SANDKASTEN_PYTHON_DEFAULT_RUN_TIMEOUT_MS`. Language aliases are normalized first, so `py` uses the `PYTHON` prefix and `c++` uses the `CPP` prefix.

Supported language values are `go`, `c`, `cpp`, `csharp`, `java`, `javascript`, `python`, `r`, `rust`, and `typescript`. Aliases such as `golang`, `c++`, `c#`, `js`, `py`, `rscript`, `rs`, and `ts` are normalized.

Default entrypoints:

- Go: `.`
- C: `main.c`
- C++: `main.cpp`
- C#: `Program.cs`
- Java: `Main.java`
- JavaScript: `main.js`
- Python: `main.py`
- R: `main.R`
- Rust: `main.rs`
- TypeScript: `main.ts`

The `archive_targz` field is required for gRPC archive submission. Go archives must contain `go.mod` and `vendor/`; other first-pass language archives may contain a single entrypoint source file.

## Submit Limits

The API applies service-side hard limits after defaults are filled. Requests above these limits are rejected before they are inserted into Postgres. The database schema also has baseline `CHECK` constraints for non-empty archives, array args, positive timeouts, memory, and output limits.

Default limits:

- `SANDKASTEN_MAX_ARCHIVE_BYTES`: `67108864`
- `SANDKASTEN_MAX_STDIN_BYTES`: `1048576`
- `SANDKASTEN_MAX_ARGS`: `64`
- `SANDKASTEN_MAX_ARG_BYTES`: `8192`
- `SANDKASTEN_MAX_COMPILE_TIMEOUT_MS`: `120000`
- `SANDKASTEN_MAX_RUN_TIMEOUT_MS`: `30000`
- `SANDKASTEN_MAX_MEMORY_LIMIT_BYTES`: `1073741824`
- `SANDKASTEN_MAX_CPU_MILLIS`: `4000`
- `SANDKASTEN_MAX_OUTPUT_BYTES`: `4194304`

Each supported runtime can override any hard limit with `SANDKASTEN_<LANG>_MAX_*`. Unset language fields inherit the global limit. Supported per-runtime names are:

- `SANDKASTEN_<LANG>_MAX_ARCHIVE_BYTES`
- `SANDKASTEN_<LANG>_MAX_STDIN_BYTES`
- `SANDKASTEN_<LANG>_MAX_ARGS`
- `SANDKASTEN_<LANG>_MAX_ARG_BYTES`
- `SANDKASTEN_<LANG>_MAX_COMPILE_TIMEOUT_MS`
- `SANDKASTEN_<LANG>_MAX_RUN_TIMEOUT_MS`
- `SANDKASTEN_<LANG>_MAX_MEMORY_LIMIT_BYTES`
- `SANDKASTEN_<LANG>_MAX_CPU_MILLIS`
- `SANDKASTEN_<LANG>_MAX_OUTPUT_BYTES`

Per-runtime default values should not exceed the effective hard limits for that runtime; otherwise the API rejects defaulted submissions before insert.

Queue backpressure is disabled by default. Set these values to reject submissions before insert when the queue is already saturated:

- `SANDKASTEN_MAX_QUEUED_JOBS`: maximum `QUEUED` jobs, `0` means unlimited
- `SANDKASTEN_MAX_ACTIVE_JOBS`: maximum `QUEUED`, `VALIDATING`, `COMPILING`, and `RUNNING` jobs combined, `0` means unlimited

Backpressure returns gRPC `ResourceExhausted` and HTTP `503 resource_exhausted`.

## Runner Retry Budget

`LAEUFER_MAX_ATTEMPTS` defaults to `3`. Every successful lease increments `jobs.attempt_count` and records a `job_attempts` row with `attempt_id`, `attempt_number`, runner id, status, phase, timestamps, terminal reason, command cgroup path, host child PID, and terminal result counters. When an active job lease expires at or above that limit, the runner marks it `SYSTEM_ERROR`, updates the latest attempt to `DEAD_LETTER` with `terminal_reason='dead_letter'`, and writes a job event instead of retrying forever.

## Runner Rlimits

The runner applies child-process rlimits before uid/gid drop and seccomp setup. Defaults are `LAEUFER_RLIMIT_CORE_BYTES=0`, `LAEUFER_RLIMIT_FSIZE_BYTES=67108864`, `LAEUFER_RLIMIT_NOFILE=1024`, `LAEUFER_RLIMIT_NPROC=64`, `LAEUFER_RLIMIT_STACK_BYTES=67108864`, and `LAEUFER_RLIMIT_MEMLOCK_BYTES=0`. Optional `LAEUFER_RLIMIT_CPU_SECONDS` is disabled when unset or `0`; when set, it installs an `RLIMIT_CPU` soft limit with a one-second higher hard limit.

Per-command cgroups also set `memory.oom.group=1`, `pids.max`, `memory.max`, and `cpu.max`. `LAEUFER_PIDS_MAX` defaults to `64`; set it to `0` to write `pids.max=max`. `LAEUFER_MEMORY_SWAP_MAX_BYTES` is optional; when set, its value is written to `memory.swap.max`, so `0` disables swap for the command cgroup.

Completed job results include cgroup diagnostics. gRPC exposes them on `JobResult` as `memory_peak_bytes`, `memory_oom_kill_count`, `cpu_usage_usec`, `cpu_throttled_usec`, and `pids_peak`; HTTP `GET /v1/jobs/{id}` returns the same values under `diagnostics`. The same terminal counters are copied to the finishing `job_attempts` row for retry forensics, alongside `terminal_reason`, `cgroup_path`, and `child_pid`.

Seccomp is enabled by default with a built-in child denylist for network syscalls and high-risk kernel interfaces. The filter includes an audit-architecture guard. Set `LAEUFER_DISABLE_SECCOMP=1` only for diagnostics.

## grpcurl Example

The API does not need server reflection if grpcurl is pointed at local protos:

```sh
tar -C beispiele/go-hello -czf /tmp/go-hello.tar.gz .
ARCHIVE="$(base64 < /tmp/go-hello.tar.gz | tr -d '\n')"

grpcurl -plaintext \
  -H "authorization: Bearer dev-token" \
  -import-path vertrag \
  -proto sandkasten/v1/jobs.proto \
  -d "{\"archiveTargz\":\"${ARCHIVE}\",\"entrypoint\":\".\"}" \
  localhost:50051 \
  sandkasten.v1.JobService/SubmitGoProject
```

See `beispiele/grpc-client/` for a reusable shell sample.

## Browser HTTP API

The API process also exposes an HTTP/JSON surface for static sites and GitHub Pages.

Default local ports:

- gRPC: `127.0.0.1:50051`
- HTTP: `127.0.0.1:8080`

Configure HTTP with:

- `SANDKASTEN_API_HTTP_ADDR`, default `127.0.0.1:8080`
- `SANDKASTEN_API_CORS_ORIGINS`, comma-separated, default local Vite origins
- `SANDKASTEN_API_TOKEN`, accepted as `authorization: Bearer <token>` or `x-sandkasten-token`

Run a single-file program and wait for the result:

```sh
curl -fsS \
  -H "authorization: Bearer dev-token" \
  -H "content-type: application/json" \
  -d '{"source":"print(\"hello\")\n","wait":true,"waitTimeoutMs":30000}' \
  http://127.0.0.1:8080/v1/python/run
```

The HTTP API accepts `POST /v1/{language}/run` and `POST /v1/run` with a JSON `language` field.

Response artifacts use `outputEncoding=auto` by default. UTF-8 artifacts are returned as normal strings; non-UTF-8 artifacts are base64 encoded. Clients may set `outputEncoding` to `utf8`, `base64`, or `auto` in the POST body. `GET /v1/jobs/{job_id}` accepts the same value as a query parameter.

```json
{
  "jobId": "...",
  "status": "JOB_STATUS_SUCCEEDED",
  "stdout": "hello\n",
  "stdoutEncoding": "utf8",
  "stderr": "",
  "stderrEncoding": "utf8",
  "durationMs": 1234
}
```
