# Deployment

Deployment assets live in `einsatz/`.

## Images

Build the API and runner images from the repository root:

```sh
docker build -f einsatz/docker/api.Dockerfile -t sandkasten-api:dev .
docker build -f einsatz/docker/laeufer.Dockerfile -t sandkasten-laeufer:dev .
```

Current assumptions:

- Checked-in Go protobuf/gRPC bindings are generated from `vertrag/`; run `./werkzeug/gen-proto.sh` after contract changes.
- The runner image includes Go plus toolchains/interpreters for Bash/Shell, C, Cangjie, Clojure, C++, C#, Coq, Elixir, Java, JavaScript, Julia, Kotlin, Lean4, Lua, Nim, Perl, PHP, Prolog, Python, R, Racket, Ruby, Rust, Scala, SQL/SQLite, Swift, TypeScript, and Zig execution.
- Production tags should use the `ghcr.io/diewehmut/sandkasten-api` and `ghcr.io/diewehmut/sandkasten-laeufer` image names from the Kubernetes manifests.

## Local Development

Start Postgres and load `speicher/schema.sql`:

```sh
./werkzeug/dev-up.sh
```

Start optional images when their build dependencies are available:

```sh
./werkzeug/dev-up.sh --with-api
./werkzeug/dev-up.sh --with-api --with-runner
```

Run the local end-to-end Go execution smoke test after Postgres is reachable:

```sh
./werkzeug/smoke-go.sh
```

The smoke script builds the API and runner locally, starts both processes, submits `beispiele/go-hello`, and requires a `SUCCEEDED` job with `hello, Sandkasten` output.

Run the full language smoke when all supported local toolchains are installed:

```sh
./werkzeug/smoke-languages.sh
```

The full smoke submits source through the HTTP API for `go`, `bash`, `cangjie`, `clojure`, `c`, `cpp`, `csharp`, `coq`, `elixir`, `java`, `javascript`, `julia`, `kotlin`, `lean4`, `lua`, `nim`, `perl`, `php`, `prolog`, `python`, `r`, `racket`, `ruby`, `rust`, `scala`, `sql`, `swift`, `typescript`, and `zig`.

## Kubernetes

1. Build and push images.
2. Replace placeholder images in `einsatz/k8s/04-api.yaml` and `einsatz/k8s/06-laeufer.yaml`.
3. Replace all values in `einsatz/k8s/02-secret.placeholder.yaml`.
4. Label and taint dedicated runner nodes:

```sh
kubectl label node <node> sandkasten.dev/runner=true
kubectl taint node <node> sandkasten.dev/runner=true:NoSchedule
```

5. Apply manifests:

```sh
kubectl apply -k einsatz/k8s
```

6. The `sandkasten-migrate` Job loads `speicher/schema.sql` through a generated ConfigMap. Re-run or recreate that Job after schema changes.

## Kubernetes Components

- Namespace: `sandkasten`.
- Postgres StatefulSet and ClusterIP service.
- API Deployment and ClusterIP gRPC service.
- Runner DaemonSet constrained to dedicated nodes.
- Migration Job for the v1 Postgres schema.
- ServiceAccount for the runner with no Kubernetes API token mounted.

The v1 manifests intentionally do not expose the API publicly. Add an internal load balancer, ingress, or port-forwarding layer according to the deployment environment.
