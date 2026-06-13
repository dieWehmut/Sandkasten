# Deployment

Deployment assets live in `einsatz/`.

## Images

Build the API and runner images from the repository root:

```sh
docker build -f einsatz/docker/api.Dockerfile -t sandkasten-api:dev .
docker build -f einsatz/docker/laeufer.Dockerfile -t sandkasten-laeufer:dev .
```

Remove stale Sandkasten images and unused BuildKit cache after repeated runtime builds:

```sh
make docker-clean
PRUNE_BUILDKIT_ALL=1 make docker-clean
```

Current assumptions:

- Checked-in Go protobuf/gRPC bindings are generated from `vertrag/`; run `./werkzeug/gen-proto.sh` after contract changes.
- The runner image includes Go plus toolchains/interpreters for Assembly, Bash/Shell, C, Cangjie, Clojure, CSS/PostCSS, C++, C#, Coq, Crystal, Dart, Elixir, Erlang, F#, Fortran, GDScript/Godot, Gleam, GNU Octave, Graphviz DOT, Haskell, HTML, Java, JavaScript, Julia, Kotlin, LaTeX/Tectonic, Lean4, Lua, Markdown/Mermaid, MDX, Mojo, Next.js, Nextflow, Nim, OCaml, Pascal/Free Pascal, Perl, PHP, Prolog, Python, QML/Qt, R, Racket, Ruby, Rust, Scala, SCSS/Sass, SQL/SQLite, Swift, Tailwind CSS, TypeScript, TSX/React, Typst, V, Vue 3, WDL, and Zig execution.
- Bare-metal or systemd runners must provide the same runtime commands on `LAEUFER_RUNTIME_PATH`. Document renderers also need globally resolvable Node packages under `NODE_PATH`, Chromium at `/usr/bin/chromium` for Mermaid, a warmed Gleam Hex cache at `/opt/sandkasten/gleam-cache`, and a Tectonic bundle/cache usable with `tectonic --only-cached`.
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

Run a single runtime or a small batch while adding toolchains incrementally:

```sh
SMOKE_LANGUAGES=ocaml ./werkzeug/smoke-languages.sh
SMOKE_LANGUAGES="markdown graphviz typst" ./werkzeug/smoke-languages.sh
createdb sandkasten_smoke
DATABASE_URL=postgres://sandkasten:sandkasten@localhost:5432/sandkasten_smoke?sslmode=disable SANDKASTEN_ADDR=127.0.0.1:50052 SANDKASTEN_HTTP_ADDR=127.0.0.1:8081 SMOKE_LANGUAGES=ocaml ./werkzeug/smoke-languages.sh
dropdb sandkasten_smoke
```

The full smoke submits source through the HTTP API for `go`, `bash`, `cangjie`, `clojure`, `css`, `c`, `cpp`, `csharp`, `coq`, `crystal`, `dart`, `elixir`, `erlang`, `fsharp`, `fortran`, `gdscript`, `gleam`, `graphviz`, `haskell`, `html`, `java`, `javascript`, `julia`, `kotlin`, `latex`, `lean4`, `lua`, `markdown`, `mdx`, `mojo`, `nextjs`, `nextflow`, `nim`, `octave`, `ocaml`, `pascal`, `assembly`, `perl`, `php`, `prolog`, `python`, `qml`, `r`, `racket`, `ruby`, `rust`, `scala`, `scss`, `sql`, `swift`, `tailwindcss`, `typst`, `typescript`, `tsx`, `vlang`, `vue3`, `wdl`, and `zig`.

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
