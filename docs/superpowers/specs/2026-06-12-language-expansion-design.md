# Language Expansion Design

## Context

Sandkasten is a self-hosted batch code execution system. The API accepts archived or HTTP single-file submissions, records jobs in Postgres, and the Rust `laeufer` runner prepares a language-specific compile/run plan before executing each command inside the existing Linux sandbox. The runner already enforces cgroup v2 limits, rlimits, private namespaces, `NO_NEW_PRIVS`, uid/gid drop, close-range fd hygiene, optional rootfs pivoting, and built-in compile/run seccomp profiles.

This expansion adds support for Fortran, GNU Octave, Gleam, Pascal, assembly, OCaml, V, MDX, LaTeX, Typst, Markdown with Mermaid support, and Graphviz DOT. It also completes the related research documentation under `/root/sandkasten-berichte` using `/root/sample` as the reference corpus.

## Reference Projects

The implementation uses local patterns from Sandkasten first. The sample repositories inform tool behavior and safety boundaries:

- `gcc`: Fortran and assembly are ordinary native toolchain workloads; use fixed compiler commands and `.laeufer-bin` outputs.
- `octave`: GNU Octave should run without GUI startup files, history, or site/user initialization.
- `gleam`: Gleam targets Erlang or JavaScript; use fixed offline build directories and the Erlang target for batch execution.
- `ocaml`: OCaml is a native compiler/runtime workload; keep build outputs in `.laeufer-bin`.
- `v` and `vlang`: V is C-backend native compilation; avoid network examples and compile to a fixed binary path.
- `markdown-it` and `marked`: Markdown rendering must disable raw HTML or sanitize output; Sandkasten should prefer safe, deterministic HTML emission.
- `mdx`: MDX compiles through a fixed Node toolchain; do not execute arbitrary React component imports from the network.
- `mermaid`: Mermaid is a diagram DSL renderer; use deterministic SVG generation and security settings.
- `graphviz`: DOT rendering should invoke `dot` with a fixed output format and bounded output.
- `tectonic` and `texlab`: LaTeX support should use an offline/frozen TeX engine where available and must not fetch packages at runtime.
- `typst`: Typst is a document compiler with local file access; compile with a fixed root and deterministic output format.

## Supported Runtime Contract

All new languages remain sandboxed batch jobs. They do not introduce interactive sessions, package installation APIs, user-provided build scripts, or network access. Each language gets a canonical name, aliases, a default entrypoint, an API runtime manifest, a runner compile phase, and a runner run phase.

Canonical languages and entrypoints:

| Language | Aliases | Entrypoint | Output |
| --- | --- | --- | --- |
| `fortran` | `f90`, `gfortran` | `main.f90` | native binary stdout |
| `octave` | `gnu-octave`, `m` | `main.m` | Octave stdout |
| `gleam` | `gleamlang` | `src/main.gleam` | Erlang target stdout |
| `pascal` | `fpc`, `freepascal` | `main.pas` | native binary stdout |
| `assembly` | `asm`, `gas`, `nasm` | `main.s` | native binary stdout |
| `ocaml` | `ml`, `ocamlopt` | `main.ml` | native binary stdout |
| `vlang` | `v`, `v-language` | `main.vv` | native binary stdout |
| `mdx` | - | `main.mdx` | static HTML stdout |
| `latex` | `tex` | `main.tex` | compile check plus text marker stdout |
| `typst` | `typ` | `main.typ` | SVG stdout |
| `markdown` | `md` | `main.md` | static HTML stdout, Mermaid fences rendered to SVG |
| `graphviz` | `dot`, `gv` | `main.dot` | SVG stdout |

`vlang` intentionally uses `main.vv` so it does not conflict with the existing Coq default `main.v`. `markdown` owns Mermaid support through fenced code blocks; a separate `mermaid` alias is not canonical because the requested feature is Markdown including Mermaid.

## Execution Plans

Native compiled runtimes use fixed compiler commands and `.laeufer-bin/main` outputs:

- Fortran: `gfortran -O2 -pipe -o .laeufer-bin/main main.f90`
- Pascal: `fpc -O2 -FE.laeufer-bin -omain main.pas`
- Assembly: `gcc -x assembler -no-pie -o .laeufer-bin/main main.s`
- OCaml: `ocamlopt -o .laeufer-bin/main main.ml`
- V: `v -prod -o .laeufer-bin/main main.vv`

Interpreted or managed runtimes avoid user/site startup and use private temp/cache locations:

- Octave compile phase parses the file with `octave-cli --no-gui --no-history --norc --silent --eval`. Run phase uses the same startup-suppression flags plus the entrypoint.
- Gleam compile phase creates a minimal project under `.laeufer-cache/gleam-project`, copies `src/main.gleam`, runs `gleam build --target erlang`, and run phase invokes the generated Erlang module with a fixed `erl -noshell` command.

Document and graph runtimes emit deterministic text artifacts:

- Markdown renders CommonMark-like HTML through the fixed Node toolchain with raw HTML disabled and Mermaid fences rendered to SVG using `mermaid` in secure mode.
- MDX compiles through the fixed Node toolchain to static HTML; raw runtime imports are not fetched.
- Graphviz invokes `dot -Tsvg main.dot` and writes SVG to stdout.
- Typst compiles `main.typ` to SVG in `.laeufer-bin/main.svg`, then stdout cats that SVG.
- LaTeX uses `tectonic --offline --keep-logs --outdir .laeufer-bin main.tex` when available; run phase emits a small deterministic success marker rather than returning PDF bytes through stdout in the initial batch interface.

## Security and Performance

The existing sandbox boundary is the primary security mechanism. This change must preserve:

- No network fetches during compile or run.
- No user-controlled build commands.
- No package manager invocation from untrusted source.
- Compile phase uses `LAEUFER_COMPILE_MEMORY_LIMIT_BYTES`; run phase uses the job memory limit.
- All generated outputs live under `.laeufer-bin` or `.laeufer-cache`.
- Tool startup files and user homes are redirected or disabled where the tool supports it.
- Node-based renderers use fixed globally installed packages and do not load remote code.
- HTML output from Markdown/MDX is generated in the child sandbox and should be treated as untrusted by clients.

The runner image must include only the fixed tools needed to support these runtimes. New tools should be installed as distro packages when practical; npm packages must be pinned.

## API and Documentation

The Go API service owns runtime manifests for HTTP and gRPC clients. The same canonical language names, aliases, default entrypoints, compile phase summaries, and run phase summaries must be added to `schnittstelle/internal/jobs/service.go` and tested in `service_test.go`.

HTTP source shortcuts must map each new canonical language and alias to the same default entrypoint. `handbuch/api.md`, `handbuch/architecture.md`, `handbuch/deployment.md`, `handbuch/runner-security.md`, `README.md`, and `werkzeug/smoke-languages.sh` must describe the new runtimes and their toolchain requirements.

`/root/sandkasten-berichte` must gain a language-expansion report and update its index/extract documents to record the borrowed ideas, the Sandkasten-specific application, and the boundaries that must not be copied.

## Testing

Each runtime requires unit coverage in both layers:

- Rust planner tests in `laeufer/crates/laeufer-sprachen/src/lib.rs` for canonical/alias planning, compile command, run command, private cache/temp behavior, and seccomp phase separation.
- Go service tests in `schnittstelle/internal/jobs/service_test.go` for aliases, default entrypoints, compile phase manifest, and run phase manifest.
- HTTP tests in `schnittstelle/internal/httpapi/server_test.go` for source shortcut entrypoint mapping.
- Smoke entries in `werkzeug/smoke-languages.sh` for end-to-end validation when all toolchains are installed.

Normal verification is `./werkzeug/test.sh`. Full runtime verification is `./werkzeug/smoke-languages.sh` on a host or image with all required toolchains. Privileged security behavior remains covered by `./werkzeug/security-tests.sh`.
