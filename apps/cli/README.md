# Sandkasten CLI

A dependency-free Node.js client for the Sandkasten HTTP API. It submits a
source file, polls the job until a terminal status, and prints the result. No
packages are required beyond Node 22.18.0.

## Usage

```sh
node apps/cli/bin/sandkasten.mjs run main.py --language python --api https://run.example.com
node apps/cli/bin/sandkasten.mjs runtimes --api http://127.0.0.1:8080
node apps/cli/bin/sandkasten.mjs job <jobId> --api http://127.0.0.1:8080
```

`run` infers the runtime from the file extension for the common languages
(`.py`, `.go`, `.rs`, `.ts`, `.sh`, ...) and falls back to the API default
(`go`) when the extension is unknown. Override it with `--language`.

Options:

- `--language <lang>`: runtime name or alias for `run`.
- `--entrypoint <path>`: override the language entrypoint.
- `--poll-interval <ms>`: polling interval, default `1000`.
- `--api <url>`: API origin, defaults to `SANDKASTEN_API_BASE_URL` or same-origin paths.
- `--token <token>`: bearer token, defaults to `SANDKASTEN_API_TOKEN`.
- `--json`: print the raw JSON payload instead of the human summary.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Job succeeded, or metadata command completed |
| 1 | Job reached a terminal failure status |
| 2 | Usage error: unknown command, missing argument, invalid option, unreadable source file |
| 3 | API or network error |

Polling stops on the eight terminal statuses (`JOB_STATUS_SUCCEEDED`,
`JOB_STATUS_COMPILE_FAILED`, `JOB_STATUS_RUNTIME_FAILED`,
`JOB_STATUS_TIME_LIMIT_EXCEEDED`, `JOB_STATUS_MEMORY_LIMIT_EXCEEDED`,
`JOB_STATUS_OUTPUT_LIMIT_EXCEEDED`, `JOB_STATUS_CANCELED`,
`JOB_STATUS_SYSTEM_ERROR`).

## Test

```sh
cd apps/cli
npm test
```

The suite covers argument parsing, URL and header construction, the printer,
and an end-to-end run against an in-process mock API.
