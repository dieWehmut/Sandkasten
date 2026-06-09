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

## Authentication

Set `SANDKASTEN_API_TOKEN` on the API to require client credentials. When the token is empty, the API accepts unauthenticated requests.

Clients may authenticate with either metadata key:

- `authorization: Bearer <token>`
- `x-sandkasten-token: <token>`

## SubmitGoProject Defaults

If omitted, the API applies these v1 defaults:

- `entrypoint`: `.`
- `compile_timeout_ms`: `30000`
- `run_timeout_ms`: `5000`
- `memory_limit_bytes`: `268435456`
- `cpu_millis`: `1000`
- `max_output_bytes`: `1048576`

The `archive_targz` field is required and must contain a Go module archive. The module must include `go.mod` and `vendor/`.

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

Run a single-file Go program and wait for the result:

```sh
curl -fsS \
  -H "authorization: Bearer dev-token" \
  -H "content-type: application/json" \
  -d '{"source":"package main\nimport \"fmt\"\nfunc main(){fmt.Println(\"hello\")}\n","wait":true,"waitTimeoutMs":30000}' \
  http://127.0.0.1:8080/v1/go/run
```

Response artifacts are UTF-8 strings:

```json
{
  "jobId": "...",
  "status": "JOB_STATUS_SUCCEEDED",
  "stdout": "hello\n",
  "stderr": "",
  "durationMs": 1234
}
```
