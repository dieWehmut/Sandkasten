# Language Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add sandboxed batch support for Fortran, GNU Octave, Gleam, Pascal, assembly, OCaml, V, MDX, LaTeX, Typst, Markdown with Mermaid, and Graphviz DOT while updating research and operations documentation.

**Architecture:** Keep the current split: Rust `laeufer-sprachen` owns executable compile/run plans, Go `schnittstelle/internal/jobs` owns API runtime manifests, HTTP API owns source shortcut entrypoints, Docker/smoke scripts own tool availability, and handbuch/berichte own operator-facing documentation. The sandbox boundary stays unchanged: fixed tool commands, no network fetches, no user scripts, private cache/temp, existing cgroup/rlimit/seccomp controls.

**Tech Stack:** Rust 2021, Go, Bash smoke scripts, Debian bookworm runtime image, Node.js renderer packages, Graphviz, Tectonic, Typst, GNU toolchains, OCaml, Free Pascal, GNU Octave, Gleam, V.

---

## File Structure

- Modify `laeufer/crates/laeufer-sprachen/src/language.rs`: canonical language and alias normalization.
- Modify `laeufer/crates/laeufer-sprachen/src/planner/mod.rs`: dispatch new languages to planner functions.
- Modify `laeufer/crates/laeufer-sprachen/src/planner/languages/compiled.rs`: Fortran, Pascal, assembly, OCaml, V native compile/run plans.
- Modify `laeufer/crates/laeufer-sprachen/src/planner/languages/interpreted.rs`: Octave, Gleam, MDX, LaTeX, Typst, Markdown/Mermaid, Graphviz plans and fixed shell/Node scripts.
- Modify `laeufer/crates/laeufer-sprachen/src/planner/languages/mod.rs`: export new planner functions.
- Modify `laeufer/crates/laeufer-sprachen/src/lib.rs`: planner unit tests.
- Modify `schnittstelle/internal/jobs/service.go`: runtime aliases, entrypoints, compile phase manifest, run phase manifest.
- Modify `schnittstelle/internal/jobs/service_test.go`: manifest tests.
- Modify `schnittstelle/internal/httpapi/server.go`: HTTP source shortcut entrypoint mapping.
- Modify `schnittstelle/internal/httpapi/server_test.go`: shortcut tests.
- Modify `einsatz/docker/laeufer.Dockerfile`: install fixed runtime tools and pinned Node packages.
- Modify `werkzeug/smoke-languages.sh`: required tools and smoke examples.
- Modify `README.md`, `handbuch/api.md`, `handbuch/architecture.md`, `handbuch/deployment.md`, `handbuch/runner-security.md`: runtime docs.
- Modify `/root/sandkasten-berichte/README.md`, `/root/sandkasten-berichte/sample-inventory.md`, `/root/sandkasten-berichte/projekt-extrakte.md`, `/root/sandkasten-berichte/sandkasten-extrakte.md`: add language-expansion references.
- Create `/root/sandkasten-berichte/language-expansion.md`: research report.

## Task 1: Research Documentation

**Files:**
- Create: `/root/sandkasten-berichte/language-expansion.md`
- Modify: `/root/sandkasten-berichte/README.md`
- Modify: `/root/sandkasten-berichte/sample-inventory.md`
- Modify: `/root/sandkasten-berichte/projekt-extrakte.md`
- Modify: `/root/sandkasten-berichte/sandkasten-extrakte.md`

- [ ] **Step 1: Write the research report**

Cover these references and decisions:

```markdown
# Language Expansion Report

## Scope

This report covers Fortran, GNU Octave, Gleam, Pascal, assembly, OCaml, V, MDX, LaTeX, Typst, Markdown with Mermaid, and Graphviz DOT for Sandkasten batch execution.

## Sources

| Runtime | Sample repositories | Sandkasten decision |
| --- | --- | --- |
| Fortran | `/root/sample/gcc` | Fixed `gfortran` compile to `.laeufer-bin/main` |
| GNU Octave | `/root/sample/octave` | `octave-cli` without GUI/history/startup |
| Gleam | `/root/sample/gleam` | Fixed Erlang target project in `.laeufer-cache` |
| Pascal | `/root/sample/gcc` plus Free Pascal toolchain | Fixed `fpc` binary output |
| Assembly | `/root/sample/gcc`, `/root/sample/ocaml/asmcomp`, `/root/sample/v/examples/asm.v` | Fixed GNU assembler path via `gcc -x assembler` |
| OCaml | `/root/sample/ocaml` | Fixed `ocamlopt` native binary |
| V | `/root/sample/v`, `/root/sample/vlang` | Fixed `v -prod` binary, entrypoint `main.vv` to avoid Coq `main.v` |
| Markdown | `/root/sample/markdown-it`, `/root/sample/marked` | Disable raw HTML and render deterministic HTML |
| MDX | `/root/sample/mdx` | Compile through fixed Node toolchain only |
| Mermaid | `/root/sample/mermaid`, `/root/sample/snakemake` | Render fenced diagrams to SVG inside Markdown |
| Graphviz DOT | `/root/sample/graphviz`, `/root/sample/snakemake` | `dot -Tsvg` output |
| LaTeX | `/root/sample/tectonic`, `/root/sample/texlab` | Offline Tectonic compile check |
| Typst | `/root/sample/typst` | Compile to SVG and emit SVG |
```

- [ ] **Step 2: Update report indexes**

Add `language-expansion.md` to the README coverage table and cross-reference it from sample inventory/extract files.

- [ ] **Step 3: Commit**

Run:

```bash
cd /root/sandkasten
git status --short
git add /root/sandkasten-berichte/language-expansion.md /root/sandkasten-berichte/README.md /root/sandkasten-berichte/sample-inventory.md /root/sandkasten-berichte/projekt-extrakte.md /root/sandkasten-berichte/sandkasten-extrakte.md
git commit -m "docs: add language expansion research"
```

Expected: commit succeeds and includes only berichte documentation.

## Task 2: Rust Planner Tests for Native and Managed Runtimes

**Files:**
- Modify: `laeufer/crates/laeufer-sprachen/src/lib.rs`

- [ ] **Step 1: Add failing tests**

Add tests for:

- `fortran_plan_compiles_with_gfortran`
- `pascal_plan_compiles_with_fpc`
- `assembly_plan_uses_gcc_assembler_mode`
- `ocaml_plan_compiles_native_binary`
- `vlang_plan_uses_vv_entrypoint_to_avoid_coq_conflict`
- `octave_plan_disables_startup_files`
- `gleam_plan_builds_private_erlang_project`

Each test should call `SprachenRuntime::plan` with the alias or canonical name, assert the compile/run program and important args, and assert compile/run seccomp phases are separated.

- [ ] **Step 2: Verify RED**

Run:

```bash
cd /root/sandkasten/laeufer
cargo test -p laeufer-sprachen fortran_plan_compiles_with_gfortran --lib
```

Expected: fails because the language is unsupported.

## Task 3: Rust Planner Implementation for Native and Managed Runtimes

**Files:**
- Modify: `laeufer/crates/laeufer-sprachen/src/language.rs`
- Modify: `laeufer/crates/laeufer-sprachen/src/planner/mod.rs`
- Modify: `laeufer/crates/laeufer-sprachen/src/planner/languages/compiled.rs`
- Modify: `laeufer/crates/laeufer-sprachen/src/planner/languages/interpreted.rs`
- Modify: `laeufer/crates/laeufer-sprachen/src/planner/languages/mod.rs`

- [ ] **Step 1: Implement normalization**

Add mappings:

```rust
"fortran" | "f90" | "gfortran" => "fortran",
"octave" | "gnu-octave" | "m" => "octave",
"gleam" | "gleamlang" => "gleam",
"pascal" | "fpc" | "freepascal" => "pascal",
"assembly" | "asm" | "gas" | "nasm" => "assembly",
"ocaml" | "ml" | "ocamlopt" => "ocaml",
"vlang" | "v" | "v-language" => "vlang",
```

- [ ] **Step 2: Implement native planners**

Use `plan_native` where possible:

```rust
plan_native(job, source_dir, env, NativeCompiler { program: "gfortran", args: vec!["-O2", "-pipe"], output_name: "main" }, entrypoint, compile_memory_limit_bytes)
plan_native(job, source_dir, env, NativeCompiler { program: "gcc", args: vec!["-x", "assembler", "-no-pie"], output_name: "main" }, entrypoint, compile_memory_limit_bytes)
plan_native(job, source_dir, env, NativeCompiler { program: "ocamlopt", args: vec![], output_name: "main" }, entrypoint, compile_memory_limit_bytes)
```

Add custom planners for Pascal and V if argument order requires fixed output paths.

- [ ] **Step 3: Implement Octave and Gleam planners**

Octave compile: fixed parse script with `octave-cli --no-gui --no-history --norc --silent --eval`.

Gleam compile: fixed shell script that creates `.laeufer-cache/gleam-project`, writes `gleam.toml`, copies `src/main.gleam`, runs `gleam build --target erlang`, and run phase calls `erl -noshell -pa .laeufer-cache/gleam-project/build/dev/erlang/*/ebin -s main main -s init stop`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
cd /root/sandkasten/laeufer
cargo test -p laeufer-sprachen fortran_plan_compiles_with_gfortran --lib
cargo test -p laeufer-sprachen pascal_plan_compiles_with_fpc --lib
cargo test -p laeufer-sprachen assembly_plan_uses_gcc_assembler_mode --lib
cargo test -p laeufer-sprachen ocaml_plan_compiles_native_binary --lib
cargo test -p laeufer-sprachen vlang_plan_uses_vv_entrypoint_to_avoid_coq_conflict --lib
cargo test -p laeufer-sprachen octave_plan_disables_startup_files --lib
cargo test -p laeufer-sprachen gleam_plan_builds_private_erlang_project --lib
```

Expected: each selected test passes.

- [ ] **Step 5: Commit**

Run:

```bash
cd /root/sandkasten
git add laeufer/crates/laeufer-sprachen/src
git commit -m "feat: add native language planners"
```

Expected: commit succeeds.

## Task 4: API Manifest Tests for Native and Managed Runtimes

**Files:**
- Modify: `schnittstelle/internal/jobs/service_test.go`
- Modify: `schnittstelle/internal/httpapi/server_test.go`

- [ ] **Step 1: Add failing manifest cases**

Add new runtime entries and table cases for the seven runtimes from Task 2. Assert aliases, entrypoints, compile prefixes, and run prefixes.

- [ ] **Step 2: Add failing HTTP source shortcut cases**

Add `/v1/f90/run`, `/v1/gnu-octave/run`, `/v1/gleamlang/run`, `/v1/fpc/run`, `/v1/asm/run`, `/v1/ml/run`, and `/v1/v/run` cases with expected canonical languages and entrypoints.

- [ ] **Step 3: Verify RED**

Run:

```bash
cd /root/sandkasten/schnittstelle
go test ./internal/jobs ./internal/httpapi
```

Expected: fails because manifests and HTTP entrypoints are not implemented yet.

## Task 5: API Manifest Implementation for Native and Managed Runtimes

**Files:**
- Modify: `schnittstelle/internal/jobs/service.go`
- Modify: `schnittstelle/internal/httpapi/server.go`

- [ ] **Step 1: Implement aliases and default entrypoints**

Mirror the Rust canonical names and aliases. Use `main.vv` for V.

- [ ] **Step 2: Implement runtime compile/run phase summaries**

Add summary commands matching the Rust plans:

```go
phase("gfortran", "-O2", "-pipe", "-o", ".laeufer-bin/main", "main.f90")
phase("octave-cli", "--no-gui", "--no-history", "--norc", "--silent", "--eval", "parse script", "main.m")
phase("bash", "--noprofile", "--norc", "-c", gleamBuildScript, "_", "src/main.gleam")
phase("fpc", "-O2", "-FE.laeufer-bin", "-omain", "main.pas")
phase("gcc", "-x", "assembler", "-no-pie", "-o", ".laeufer-bin/main", "main.s")
phase("ocamlopt", "-o", ".laeufer-bin/main", "main.ml")
phase("v", "-prod", "-o", ".laeufer-bin/main", "main.vv")
```

- [ ] **Step 3: Verify GREEN**

Run:

```bash
cd /root/sandkasten/schnittstelle
go test ./internal/jobs ./internal/httpapi
```

Expected: passes.

- [ ] **Step 4: Commit**

Run:

```bash
cd /root/sandkasten
git add schnittstelle/internal/jobs/service.go schnittstelle/internal/jobs/service_test.go schnittstelle/internal/httpapi/server.go schnittstelle/internal/httpapi/server_test.go
git commit -m "feat: expose native language manifests"
```

Expected: commit succeeds.

## Task 6: Rust Planner Tests for Document and Graph Runtimes

**Files:**
- Modify: `laeufer/crates/laeufer-sprachen/src/lib.rs`

- [ ] **Step 1: Add failing tests**

Add tests for:

- `markdown_plan_renders_safe_html_with_mermaid`
- `mdx_plan_compiles_to_static_html`
- `graphviz_plan_renders_svg_with_dot`
- `typst_plan_emits_svg`
- `latex_plan_checks_offline_with_tectonic`

- [ ] **Step 2: Verify RED**

Run:

```bash
cd /root/sandkasten/laeufer
cargo test -p laeufer-sprachen markdown_plan_renders_safe_html_with_mermaid --lib
```

Expected: fails because the language is unsupported.

## Task 7: Rust Planner Implementation for Document and Graph Runtimes

**Files:**
- Modify: `laeufer/crates/laeufer-sprachen/src/language.rs`
- Modify: `laeufer/crates/laeufer-sprachen/src/planner/mod.rs`
- Modify: `laeufer/crates/laeufer-sprachen/src/planner/languages/interpreted.rs`
- Modify: `laeufer/crates/laeufer-sprachen/src/planner/languages/mod.rs`

- [ ] **Step 1: Implement normalization**

Add mappings:

```rust
"markdown" | "md" => "markdown",
"mdx" => "mdx",
"latex" | "tex" => "latex",
"typst" | "typ" => "typst",
"graphviz" | "dot" | "gv" => "graphviz",
```

- [ ] **Step 2: Implement fixed render scripts**

Implement scripts as constants in `interpreted.rs`:

- `MARKDOWN_RENDER_SCRIPT`: Node script using fixed `markdown-it` with `html: false`; detect `mermaid` fences and replace them with SVG through fixed Mermaid renderer.
- `MDX_RENDER_SCRIPT`: Node script using fixed MDX compiler and React static renderer.
- `GRAPHVIZ_RENDER_SCRIPT`: `dot -Tsvg "$entrypoint"`.
- `TYPST_RENDER_SCRIPT`: `typst compile --root . "$entrypoint" .laeufer-bin/main.svg` then `cat`.
- `LATEX_CHECK_SCRIPT`: `tectonic --offline --keep-logs --outdir .laeufer-bin "$entrypoint"` then run phase emits `latex compiled\n`.

- [ ] **Step 3: Verify GREEN**

Run:

```bash
cd /root/sandkasten/laeufer
cargo test -p laeufer-sprachen markdown_plan_renders_safe_html_with_mermaid --lib
cargo test -p laeufer-sprachen mdx_plan_compiles_to_static_html --lib
cargo test -p laeufer-sprachen graphviz_plan_renders_svg_with_dot --lib
cargo test -p laeufer-sprachen typst_plan_emits_svg --lib
cargo test -p laeufer-sprachen latex_plan_checks_offline_with_tectonic --lib
```

Expected: each selected test passes.

- [ ] **Step 4: Commit**

Run:

```bash
cd /root/sandkasten
git add laeufer/crates/laeufer-sprachen/src
git commit -m "feat: add document language planners"
```

Expected: commit succeeds.

## Task 8: API Manifest Implementation for Document and Graph Runtimes

**Files:**
- Modify: `schnittstelle/internal/jobs/service_test.go`
- Modify: `schnittstelle/internal/httpapi/server_test.go`
- Modify: `schnittstelle/internal/jobs/service.go`
- Modify: `schnittstelle/internal/httpapi/server.go`

- [ ] **Step 1: Add failing tests**

Add manifest and HTTP source shortcut cases for `markdown`, `mdx`, `latex`, `typst`, and `graphviz`.

- [ ] **Step 2: Verify RED**

Run:

```bash
cd /root/sandkasten/schnittstelle
go test ./internal/jobs ./internal/httpapi
```

Expected: fails before implementation.

- [ ] **Step 3: Implement service and HTTP mappings**

Add canonical names, aliases, entrypoints, compile phases, and run phases. `markdown` gets alias `md`; `graphviz` gets aliases `dot` and `gv`; `latex` gets alias `tex`; `typst` gets alias `typ`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
cd /root/sandkasten/schnittstelle
go test ./internal/jobs ./internal/httpapi
```

Expected: passes.

- [ ] **Step 5: Commit**

Run:

```bash
cd /root/sandkasten
git add schnittstelle/internal/jobs/service.go schnittstelle/internal/jobs/service_test.go schnittstelle/internal/httpapi/server.go schnittstelle/internal/httpapi/server_test.go
git commit -m "feat: expose document language manifests"
```

Expected: commit succeeds.

## Task 9: Runtime Image, Smoke Script, and Handbuch

**Files:**
- Modify: `einsatz/docker/laeufer.Dockerfile`
- Modify: `werkzeug/smoke-languages.sh`
- Modify: `README.md`
- Modify: `handbuch/api.md`
- Modify: `handbuch/architecture.md`
- Modify: `handbuch/deployment.md`
- Modify: `handbuch/runner-security.md`

- [ ] **Step 1: Update runtime image**

Install distro packages: `gfortran`, `fpc`, `ocaml-nox`, `octave`, `graphviz`.

Install pinned external tools where distro packages are unsuitable: Gleam, V, Typst, Tectonic.

Install pinned npm packages: `markdown-it`, `mermaid`, `@mdx-js/mdx`, `react`, `react-dom`, and any required renderer helpers.

- [ ] **Step 2: Update smoke required tools**

Add `need_runtime_tool` checks for `gfortran`, `octave-cli`, `gleam`, `fpc`, `gcc`, `ocamlopt`, `v`, `node`, `dot`, `tectonic`, and `typst`.

- [ ] **Step 3: Add smoke examples**

Add minimal examples for every new runtime with expected output. Use simple deterministic programs and documents.

- [ ] **Step 4: Update docs**

Update supported runtime lists, API runtime table, deployment tool list, and runner security language list. Document that document/graph runtimes emit untrusted HTML/SVG/text through stdout and must be previewed only by clients using sandboxed policies.

- [ ] **Step 5: Verify**

Run:

```bash
cd /root/sandkasten
./werkzeug/test.sh
```

Expected: passes.

Do not require `./werkzeug/smoke-languages.sh` unless the current host has every toolchain; if it cannot run locally, note that it requires the updated runner image.

- [ ] **Step 6: Commit**

Run:

```bash
cd /root/sandkasten
git add einsatz/docker/laeufer.Dockerfile werkzeug/smoke-languages.sh README.md handbuch/api.md handbuch/architecture.md handbuch/deployment.md handbuch/runner-security.md
git commit -m "docs: document expanded runtime toolchains"
```

Expected: commit succeeds.

## Task 10: Final Verification

**Files:** all changed files.

- [ ] **Step 1: Run full unit verification**

Run:

```bash
cd /root/sandkasten
./werkzeug/test.sh
```

Expected: all Go and Rust tests pass; privileged black-box tests remain ignored.

- [ ] **Step 2: Inspect commits and status**

Run:

```bash
cd /root/sandkasten
git status --short
git log --oneline -8
```

Expected: working tree clean except intentionally uncommitted external report work if any; recent commits show design, research, planner, API, docs batches.

- [ ] **Step 3: Completion audit**

Verify each requested language appears in:

- Rust normalization and planner dispatch.
- Rust planner tests.
- Go runtime manifest and service tests.
- HTTP source shortcut and tests.
- Smoke script.
- API/architecture/deployment/security docs.
- `/root/sandkasten-berichte/language-expansion.md`.

Only mark the goal complete if every item is present and verified.
