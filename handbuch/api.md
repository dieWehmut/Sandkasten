# API

The gRPC contracts live under `vertrag/sandkasten/v1`. Generate client/server bindings with:

```sh
./werkzeug/development/gen-proto.sh
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

Supported runtimes and default entrypoints:

| Language | Aliases | Default entrypoint |
| --- | --- | --- |
| `go` | `golang` | `.` |
| `assembly` | `asm`, `gas` | `main.s` |
| `bash` | `shell`, `sh` | `main.sh` |
| `c` | - | `main.c` |
| `cangjie` | `cj`, `cjc`, `仓颉` | `main.cj` |
| `clojure` | `clj` | `main.clj` |
| `css` | - | `main.css` |
| `cpp` | `c++` | `main.cpp` |
| `csharp` | `cs`, `c#` | `Program.cs` |
| `coq` | `coqtop`, `coqc` | `main.v` |
| `crystal` | `cr` | `main.cr` |
| `dart` | - | `main.dart` |
| `elixir` | `ex`, `exs` | `main.exs` |
| `erlang` | `erl`, `erts` | `main.erl` |
| `fsharp` | `f#`, `fs`, `f-sharp`, `f_sharp` | `main.fs` |
| `fortran` | `f90`, `gfortran` | `main.f90` |
| `gdscript` | `gd`, `godot`, `godot3` | `main.gd` |
| `gleam` | `gleamlang` | `src/main.gleam` |
| `graphviz` | `dot`, `gv` | `main.dot` |
| `haskell` | `hs`, `ghc` | `Main.hs` |
| `html` | `htm` | `index.html` |
| `java` | - | `Main.java` |
| `javascript` | `js`, `node` | `main.js` |
| `julia` | `jl` | `main.jl` |
| `kotlin` | `kt` | `Main.kt` |
| `latex` | `tex` | `main.tex` |
| `lean4` | `lean` | `Main.lean` |
| `lua` | `lua5.4` | `main.lua` |
| `markdown` | `md` | `main.md` |
| `mdx` | - | `main.mdx` |
| `mojo` | `mojolang` | `main.mojo` |
| `nextjs` | `next`, `next.js` | `app/page.tsx` |
| `nextflow` | `nf` | `main.nf` |
| `nim` | `nimrod` | `main.nim` |
| `octave` | `gnu-octave`, `m` | `main.m` |
| `ocaml` | `ml`, `ocamlopt` | `main.ml` |
| `pascal` | `fpc`, `freepascal` | `main.pas` |
| `perl` | `perl5` | `main.pl` |
| `php` | `php8`, `php8.2` | `main.php` |
| `prolog` | `pl`, `swi-prolog`, `swipl` | `main.pl` |
| `python` | `py`, `python3` | `main.py` |
| `qml` | `qtqml`, `qml5`, `qml6` | `main.qml` |
| `r` | `rscript` | `main.R` |
| `racket` | `rkt` | `main.rkt` |
| `ruby` | `rb` | `main.rb` |
| `rust` | `rs` | `main.rs` |
| `scala` | `sc` | `Main.scala` |
| `scss` | `sass` | `main.scss` |
| `sql` | `sqlite`, `sqlite3` | `main.sql` |
| `swift` | - | `main.swift` |
| `tailwindcss` | `tailwind`, `tailwind-css` | `main.css` |
| `typst` | `typ` | `main.typ` |
| `typescript` | `ts` | `main.ts` |
| `tsx` | `jsx`, `react`, `react-tsx` | `main.tsx` |
| `vlang` | `v`, `v-language` | `main.vv` |
| `vue3` | `vue`, `vuejs` | `main.vue` |
| `wdl` | `workflow-description-language` | `main.wdl` |
| `zig` | - | `main.zig` |

The frontend and document runtimes are still sandboxed batch jobs. `html` and `css` validate and return source text, `scss` and `tailwindcss` return compiled CSS, `tsx` and `vue3` run server-side rendering through the bundled Node toolchain, `nextjs` renders the default `app/page.tsx` component to static HTML, `markdown`/`mdx` return static HTML, and `graphviz`, `latex`, and `typst` return SVG. `markdown` Mermaid fences render inside the child sandbox and the resulting HTML/SVG must be treated as untrusted output.

The `archive_targz` field is required for gRPC archive submission. Go archives must contain `go.mod` and `vendor/`; non-Go language archives may contain a single entrypoint source file. `nextjs` uses `app/page.tsx` as its generated source path when submitted through the HTTP source shortcut.

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

`LAEUFER_MAX_CONCURRENT_JOBS` defaults to `4`. A runner leases and executes up to that many jobs concurrently, with independent lease heartbeats and cancel watchers for each active attempt. `LAEUFER_DATABASE_MAX_CONNECTIONS` defaults to `max(5, LAEUFER_MAX_CONCURRENT_JOBS*3+2)` so concurrent jobs, heartbeats, cancel watchers, and notification listeners do not starve the Postgres pool.

`LAEUFER_MAX_ATTEMPTS` defaults to `3`. Every successful lease increments `jobs.attempt_count` and records a `job_attempts` row with `attempt_id`, `attempt_number`, runner id, status, phase, timestamps, terminal reason, command cgroup path, host child PID, and terminal result counters. When an active job lease expires at or above that limit, the runner marks it `SYSTEM_ERROR`, updates the latest attempt to `DEAD_LETTER` with `terminal_reason='dead_letter'`, and writes a job event instead of retrying forever.

## Runner Rlimits

The runner applies child-process rlimits before uid/gid drop and seccomp setup. Defaults are `LAEUFER_RLIMIT_CORE_BYTES=0`, `LAEUFER_RLIMIT_FSIZE_BYTES=67108864`, `LAEUFER_RLIMIT_NOFILE=1024`, `LAEUFER_RLIMIT_NPROC=64`, `LAEUFER_RLIMIT_STACK_BYTES=67108864`, and `LAEUFER_RLIMIT_MEMLOCK_BYTES=0`. When `LAEUFER_RLIMIT_CPU_SECONDS` is unset, the runner derives `RLIMIT_CPU` from each command's timeout and CPU budget; setting it installs that fixed soft limit with a one-second higher hard limit and overrides per-runtime budgets.

Per-command cgroups also set `memory.oom.group=1`, `pids.max`, `memory.max`, `cpu.max`, and `memory.swap.max`. `LAEUFER_PIDS_MAX` defaults to `64`; set it to `0` to write `pids.max=max`. `LAEUFER_MEMORY_SWAP_MAX_BYTES` defaults to `0`, which disables swap for the command cgroup.

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

### GitHub Pages clients

The Vue client is built from `webui/src/` and its four-file `webui/dist/`
payload is published at
<https://diewehmut.github.io/Sandkasten/> by `.github/workflows/pages.yml`.
Set the repository variable `SANDKASTEN_API_BASE_URL` to a public HTTPS API
origin (optionally with a path prefix) so the generated Pages `config.js` can
resolve `/v1/` requests. This variable is intentionally public static
configuration; never put `SANDKASTEN_API_TOKEN` or any other secret in it. The
API must be served over HTTPS and its `SANDKASTEN_API_CORS_ORIGINS` list must
include `https://diewehmut.github.io` when the API is hosted on another origin.
The allowed CORS value is the origin only, not the `/Sandkasten/` repository
path. Same-origin WebUI installs behind Nginx do not need this CORS entry.

Run a single-file program and wait for the result:

```sh
curl -fsS \
  -H "authorization: Bearer dev-token" \
  -H "content-type: application/json" \
  -d '{"source":"print(\"hello\")\n","wait":true,"waitTimeoutMs":30000}' \
  http://127.0.0.1:8080/v1/python/run
```

The HTTP API accepts `POST /v1/{language}/run` and `POST /v1/run` with a JSON `language` field.

The built `webui/dist/` client uses this same-origin surface directly. When
installed in WebUI mode, the installer copies only `index.html`, `app.js`,
`styles.css`, and `config.js`; it does not run npm on the server. Nginx serves
the client from
`SANDKASTEN_WEBUI_DIR` (default `/opt/sandkasten/webui`) and forwards `/v1/`
and `/healthz` to the API. It loads `GET /v1/runtimes`, submits source to
`POST /v1/{language}/run`, and polls `GET /v1/jobs/{jobId}`; no cross-origin
request or frontend package manager is required.

The WebUI's **Stop polling** control aborts only its current browser-side GET
request/timer and reports that the job may still be running. It does not call
the gRPC cancellation method or claim server cancellation. **Resume polling**
continues `GET /v1/jobs/{jobId}` when a job ID is available.

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
