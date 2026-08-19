# Deployment

Deployment assets live in `einsatz/`.

## Bare-metal installer

For a Debian/Ubuntu x86_64 host, the supported clone-free entrypoint is
`werkzeug/install.sh`:

```sh
curl -fsSL https://cdn.jsdelivr.net/gh/dieWehmut/sandkasten@main/werkzeug/install.sh -o sandkasten-install.sh \
  && chmod +x sandkasten-install.sh \
  && sudo ./sandkasten-install.sh
```

With no arguments the installer is interactive: it asks for the deployment
mode (`cli` or `webui`) and then the language selection. The language prompt
accepts comma- or space-separated names, one-based menu numbers, ranges such
as `1-10`, and the `core`, `web`, and `all` presets. The same choices can be
passed non-interactively:

```sh
sudo ./werkzeug/install.sh --mode cli --languages core --non-interactive
sudo ./werkzeug/install.sh --mode webui --languages python,typescript
```

`--mode cli|webui` selects backend-only or backend-plus-WebUI deployment.
`--languages LIST` validates and selects runtimes; `--dry-run` parses these
options and prints the selected mode, languages, and command without changing
the host. Existing `deploy.sh` commands remain compatible and forward to this
installer.

In `webui` mode the checked-in `webui/` directory is copied to
`/opt/sandkasten/webui` (override with `SANDKASTEN_WEBUI_DIR`). Nginx serves
that directory and proxies `/v1/` and `/healthz` to the API, so the browser
client uses same-origin relative URLs and does not require CORS configuration.
`cli` mode installs no static files or WebUI Nginx location.

The installer also supports `status`, `restart`, `languages`/`reconfigure`,
`domain`, and `uninstall` subcommands. To remove a deployment, use
`sudo ./werkzeug/install.sh uninstall` (or `werkzeug/uninstall.sh`); the
uninstaller supports interactive confirmation, `--dry-run`, and `--purge`.

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
- The runner image includes Go plus toolchains/interpreters for Assembly, Bash/Shell, C, Cangjie, Clojure, CSS/PostCSS, C++, C#, Coq, Crystal, Dart, Elixir, Erlang, F#, Fortran, GDScript/Godot, Gleam, GNU Octave, Graphviz DOT, Haskell, HTML, Java, JavaScript, Julia, Kotlin, LaTeX/Tectonic plus Poppler SVG conversion, Lean4, Lua, Markdown/Mermaid, MDX, Mojo, Next.js, Nextflow, Nim, OCaml, Pascal/Free Pascal, Perl, PHP, Prolog, Python, QML/Qt, R, Racket, Ruby, Rust, Scala, SCSS/Sass, SQL/SQLite, Swift, Tailwind CSS, TypeScript, TSX/React, Typst, V, Vue 3, WDL, and Zig execution.
- Bare-metal or systemd runners must provide the same runtime commands on `LAEUFER_RUNTIME_PATH`. Document renderers also need globally resolvable Node packages under `NODE_PATH`, a warmed Gleam Hex cache at `/opt/sandkasten/gleam-cache`, a Tectonic bundle/cache usable with `tectonic --only-cached`, and `pdftocairo` from Poppler for LaTeX SVG output.
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

Verify runner parallelism against a live HTTP API with:

```sh
node ./werkzeug/smoke-concurrency.mjs
```

The smoke submits four Bash jobs that each sleep for three seconds. It fails if wall time looks serialized or if fewer than two active jobs are observed at once.

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
