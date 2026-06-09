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
