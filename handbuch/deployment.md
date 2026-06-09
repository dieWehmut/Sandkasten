# Deployment

Deployment assets live in `einsatz/`.

## Images

Build the API and runner images from the repository root:

```sh
docker build -f einsatz/docker/api.Dockerfile -t sandkasten-api:dev .
docker build -f einsatz/docker/laeufer.Dockerfile -t sandkasten-laeufer:dev .
```

Current assumptions:

- The checked-in handwritten Go bindings are enough for the API image; `./werkzeug/gen-proto.sh` can replace them when `buf` is available.
- The runner image includes the Go toolchain because v1 executes Go projects.
- Production tags replace the placeholder image names in Kubernetes manifests.

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
