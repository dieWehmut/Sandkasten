# grpc-client Example

`submit-go-project.sh` packages a Go project and submits it to the Sandkasten gRPC API with `grpcurl`.

Requirements:

- `tar`
- `base64`
- `grpcurl`

Example:

```sh
SANDKASTEN_ADDR=localhost:50051 \
SANDKASTEN_API_TOKEN=dev-token \
./beispiele/grpc-client/submit-go-project.sh beispiele/go-hello
```

The script uses local protobuf files from `vertrag/`, so server reflection is not required.
