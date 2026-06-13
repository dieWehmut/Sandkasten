#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="/usr/local/go/bin:$PATH:/usr/local/bin:/usr/bin:/bin"

DB_URL="${DATABASE_URL:-postgres://sandkasten:sandkasten@localhost:5432/sandkasten?sslmode=disable}"
API_ADDR="${SANDKASTEN_ADDR:-127.0.0.1:50051}"
HTTP_ADDR="${SANDKASTEN_HTTP_ADDR:-127.0.0.1:8080}"
API_TOKEN="${SANDKASTEN_API_TOKEN:-dev-token}"
RUNNER_WORK_DIR="${LAEUFER_WORK_DIR:-/tmp/sandkasten-laeufer-smoke-languages}"
COMPILE_MEMORY_LIMIT_BYTES="${LAEUFER_COMPILE_MEMORY_LIMIT_BYTES:-1073741824}"
RUNTIME_PATH="${LAEUFER_RUNTIME_PATH:-/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin}"
SMOKE_LANGUAGES="${SMOKE_LANGUAGES:-}"
SMOKE_LANGUAGE_FILTERED=0

declare -A SELECTED_LANGUAGES=()

normalize_smoke_language() {
  local language="${1,,}"
  case "$language" in
    all) printf '%s\n' "all" ;;
    go | bash | c | cangjie | clojure | css | cpp | csharp | coq | crystal | dart | elixir | erlang | fsharp | fortran | gdscript | gleam | graphviz | haskell | html | java | javascript | julia | kotlin | lean4 | latex | lua | markdown | mdx | mojo | nextjs | nextflow | nim | octave | ocaml | pascal | assembly | perl | php | prolog | python | qml | r | racket | ruby | rust | scala | scss | sql | swift | tailwindcss | typescript | tsx | typst | vue3 | vlang | wdl | zig)
      printf '%s\n' "$language"
      ;;
    asm | gas | nasm) printf '%s\n' "assembly" ;;
    shell | sh) printf '%s\n' "bash" ;;
    cj | cjc) printf '%s\n' "cangjie" ;;
    clj) printf '%s\n' "clojure" ;;
    c++) printf '%s\n' "cpp" ;;
    cs | c#) printf '%s\n' "csharp" ;;
    coqtop | coqc) printf '%s\n' "coq" ;;
    cr) printf '%s\n' "crystal" ;;
    ex | exs) printf '%s\n' "elixir" ;;
    erl | erts) printf '%s\n' "erlang" ;;
    f# | fs | f-sharp | f_sharp) printf '%s\n' "fsharp" ;;
    f90 | gfortran) printf '%s\n' "fortran" ;;
    gd | godot | godot3) printf '%s\n' "gdscript" ;;
    gleamlang) printf '%s\n' "gleam" ;;
    dot | gv) printf '%s\n' "graphviz" ;;
    hs | ghc) printf '%s\n' "haskell" ;;
    htm) printf '%s\n' "html" ;;
    js | node) printf '%s\n' "javascript" ;;
    jl) printf '%s\n' "julia" ;;
    kt) printf '%s\n' "kotlin" ;;
    lean) printf '%s\n' "lean4" ;;
    tex) printf '%s\n' "latex" ;;
    lua5.4) printf '%s\n' "lua" ;;
    md) printf '%s\n' "markdown" ;;
    mojolang) printf '%s\n' "mojo" ;;
    next | next.js) printf '%s\n' "nextjs" ;;
    nf) printf '%s\n' "nextflow" ;;
    nimrod) printf '%s\n' "nim" ;;
    gnu-octave | m) printf '%s\n' "octave" ;;
    ml | ocamlopt) printf '%s\n' "ocaml" ;;
    fpc | freepascal) printf '%s\n' "pascal" ;;
    perl5) printf '%s\n' "perl" ;;
    php8 | php8.2) printf '%s\n' "php" ;;
    pl | swi-prolog | swipl) printf '%s\n' "prolog" ;;
    py | python3) printf '%s\n' "python" ;;
    qtqml | qml5 | qml6) printf '%s\n' "qml" ;;
    rscript) printf '%s\n' "r" ;;
    rkt) printf '%s\n' "racket" ;;
    rb) printf '%s\n' "ruby" ;;
    rs) printf '%s\n' "rust" ;;
    sc) printf '%s\n' "scala" ;;
    sass) printf '%s\n' "scss" ;;
    sqlite | sqlite3) printf '%s\n' "sql" ;;
    tailwind | tailwind-css) printf '%s\n' "tailwindcss" ;;
    ts) printf '%s\n' "typescript" ;;
    jsx | react | react-tsx) printf '%s\n' "tsx" ;;
    typ) printf '%s\n' "typst" ;;
    v | v-language) printf '%s\n' "vlang" ;;
    vue | vuejs) printf '%s\n' "vue3" ;;
    workflow-description-language) printf '%s\n' "wdl" ;;
    *)
      printf 'unsupported SMOKE_LANGUAGES item: %s\n' "$1" >&2
      return 1
      ;;
  esac
}

if [[ -n "$SMOKE_LANGUAGES" ]]; then
  SMOKE_LANGUAGE_FILTERED=1
  for raw_language in ${SMOKE_LANGUAGES//,/ }; do
    [[ -n "$raw_language" ]] || continue
    language="$(normalize_smoke_language "$raw_language")"
    if [[ "$language" == "all" ]]; then
      SELECTED_LANGUAGES=()
      SMOKE_LANGUAGE_FILTERED=0
      break
    fi
    SELECTED_LANGUAGES["$language"]=1
  done
  if [[ "$SMOKE_LANGUAGE_FILTERED" -eq 1 && "${#SELECTED_LANGUAGES[@]}" -eq 0 ]]; then
    printf 'SMOKE_LANGUAGES did not select any runtime\n' >&2
    exit 2
  fi
  if [[ "$SMOKE_LANGUAGE_FILTERED" -eq 1 ]]; then
    printf 'Running filtered language smoke: %s\n' "$(IFS=,; printf '%s' "${!SELECTED_LANGUAGES[*]}")"
  fi
fi

language_selected() {
  local language="$1"
  if [[ "$SMOKE_LANGUAGE_FILTERED" -eq 0 ]]; then
    return 0
  fi
  [[ -n "${SELECTED_LANGUAGES[$language]:-}" ]]
}

split_listen_address() {
  local address="$1"
  local host port
  if [[ "$address" == \[*\]:* ]]; then
    host="${address%%]*}"
    host="${host#[}"
    port="${address##*:}"
  elif [[ "$address" == :* ]]; then
    host="127.0.0.1"
    port="${address#:}"
  else
    host="${address%:*}"
    port="${address##*:}"
  fi
  if [[ -z "$host" || "$host" == "0.0.0.0" || "$host" == "::" ]]; then
    host="127.0.0.1"
  fi
  if [[ -z "$port" || "$port" == "$address" ]]; then
    printf 'address %q must include a TCP port\n' "$address" >&2
    return 2
  fi
  printf '%s %s\n' "$host" "$port"
}

listen_address_in_use() {
  local host port
  read -r host port < <(split_listen_address "$1")
  # shellcheck disable=SC2016
  timeout 1 bash -c ': >/dev/tcp/"$1"/"$2"' bash "$host" "$port" >/dev/null 2>&1
}

ensure_listen_address_free() {
  local label="$1"
  local address="$2"
  if listen_address_in_use "$address"; then
    printf '%s listen address is already in use: %s\n' "$label" "$address" >&2
    printf 'Set SANDKASTEN_ADDR/SANDKASTEN_HTTP_ADDR to free ports or stop the existing service before running the smoke.\n' >&2
    exit 98
  fi
}

ensure_no_existing_runner() {
  if [[ -n "${DATABASE_URL:-}" ]]; then
    return 0
  fi
  local runners
  runners="$(ps -eo pid=,comm=,args= | awk '$2 == "laeufer" { print }')"
  if [[ -n "$runners" ]]; then
    printf 'existing laeufer runner process detected; language smoke needs an isolated job queue\n' >&2
    printf '%s\n' "$runners" >&2
    printf 'Stop the existing runner or point DATABASE_URL at an isolated smoke database before running this script.\n' >&2
    exit 99
  fi
}

api_pid=""
runner_pid=""

cleanup() {
  if [[ -n "$runner_pid" ]] && kill -0 "$runner_pid" >/dev/null 2>&1; then
    kill "$runner_pid" >/dev/null 2>&1 || true
    wait "$runner_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$api_pid" ]] && kill -0 "$api_pid" >/dev/null 2>&1; then
    kill "$api_pid" >/dev/null 2>&1 || true
    wait "$api_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

need_tool() {
  local name="$1"
  local hint="$2"
  if ! command -v "$name" >/dev/null 2>&1; then
    printf 'missing required tool: %s\n%s\n' "$name" "$hint" >&2
    exit 127
  fi
}

need_runtime_tool() {
  local name="$1"
  local hint="$2"
  if ! PATH="$RUNTIME_PATH" command -v "$name" >/dev/null 2>&1; then
    printf 'missing runtime tool in LAEUFER_RUNTIME_PATH: %s\n%s\nruntime path: %s\n' "$name" "$hint" "$RUNTIME_PATH" >&2
    exit 127
  fi
}

need_language_runtime_tool() {
  local language="$1"
  shift
  if language_selected "$language"; then
    need_runtime_tool "$@"
  fi
}

json_string() {
  jq -Rs .
}

submit_language() {
  local language="$1"
  local source_json="$2"
  local memory="$3"
  local response_file response http_status curl_status
  response_file="$(mktemp)"
  http_status="$(
    curl -sS \
      -o "$response_file" \
      -w '%{http_code}' \
      -H "authorization: Bearer ${API_TOKEN}" \
      -H 'content-type: application/json' \
      -d "{\"source\":${source_json},\"wait\":true,\"waitTimeoutMs\":60000,\"compileTimeoutMs\":60000,\"runTimeoutMs\":10000,\"memoryLimitBytes\":${memory},\"maxOutputBytes\":1048576}" \
      "http://${HTTP_ADDR}/v1/${language}/run"
  )"
  curl_status="$?"
  if [[ "$curl_status" -ne 0 ]]; then
    response="$(cat "$response_file" 2>/dev/null || true)"
    rm -f "$response_file"
    printf '%s smoke HTTP request failed with curl status %s\n' "$language" "$curl_status" >&2
    if [[ -n "$response" ]]; then
      printf 'response: %s\n' "$response" >&2
    fi
    exit "$curl_status"
  fi
  response="$(cat "$response_file")"
  rm -f "$response_file"
  if (( http_status < 200 || http_status >= 300 )); then
    printf '%s smoke HTTP request failed with status %s\nresponse: %s\n' "$language" "$http_status" "$response" >&2
    printf 'API log:\n' >&2
    cat /tmp/sandkasten-api-smoke-languages.log >&2
    printf 'runner log:\n' >&2
    cat /tmp/sandkasten-runner-smoke-languages.log >&2
    exit 1
  fi
  printf '%s' "$response"
}

run_language() {
  local language="$1"
  if ! language_selected "$language"; then
    return 0
  fi
  local expected="$2"
  local source="$3"
  local memory="${4:-805306368}"
  local source_json
  source_json="$(printf '%s' "$source" | json_string)"

  printf 'Submitting %s example...\n' "$language"
  local response
  response="$(submit_language "$language" "$source_json" "$memory")"
  local status stdout got_language compile_stderr stderr job_id
  status="$(jq -r '.status' <<<"$response")"
  stdout="$(jq -r '.stdout' <<<"$response")"
  got_language="$(jq -r '.language' <<<"$response")"
  compile_stderr="$(jq -r '.compileStderr' <<<"$response")"
  stderr="$(jq -r '.stderr' <<<"$response")"
  job_id="$(jq -r '.jobId' <<<"$response")"

  if [[ "$status" != "JOB_STATUS_SUCCEEDED" || "$got_language" != "$language" || "$stdout" != "$expected" ]]; then
    printf '%s smoke failed\njob: %s\nstatus: %s\nlanguage: %s\nstdout: %q\nstderr: %q\ncompileStderr: %q\nresponse: %s\n' \
      "$language" "$job_id" "$status" "$got_language" "$stdout" "$stderr" "$compile_stderr" "$response" >&2
    printf 'runner log:\n' >&2
    cat /tmp/sandkasten-runner-smoke-languages.log >&2
    exit 1
  fi
  printf '  ok %s: %s\n' "$language" "$stdout"
}

run_language_contains() {
  local language="$1"
  if ! language_selected "$language"; then
    return 0
  fi
  local expected_fragment="$2"
  local source="$3"
  local memory="${4:-805306368}"
  local source_json
  source_json="$(printf '%s' "$source" | json_string)"

  printf 'Submitting %s example...\n' "$language"
  local response
  response="$(submit_language "$language" "$source_json" "$memory")"
  local status stdout got_language compile_stderr stderr job_id
  status="$(jq -r '.status' <<<"$response")"
  stdout="$(jq -r '.stdout' <<<"$response")"
  got_language="$(jq -r '.language' <<<"$response")"
  compile_stderr="$(jq -r '.compileStderr' <<<"$response")"
  stderr="$(jq -r '.stderr' <<<"$response")"
  job_id="$(jq -r '.jobId' <<<"$response")"

  if [[ "$status" != "JOB_STATUS_SUCCEEDED" || "$got_language" != "$language" || "$stdout" != *"$expected_fragment"* ]]; then
    printf '%s smoke failed\njob: %s\nstatus: %s\nlanguage: %s\nexpected fragment: %q\nstdout: %q\nstderr: %q\ncompileStderr: %q\nresponse: %s\n' \
      "$language" "$job_id" "$status" "$got_language" "$expected_fragment" "$stdout" "$stderr" "$compile_stderr" "$response" >&2
    printf 'runner log:\n' >&2
    cat /tmp/sandkasten-runner-smoke-languages.log >&2
    exit 1
  fi
  printf '  ok %s contains: %s\n' "$language" "$expected_fragment"
}

need_tool go "Install Go 1.25+ for the API module."
need_tool cargo "Install Rust/Cargo for the runner."
need_tool grpcurl "Install grpcurl or run: go install github.com/fullstorydev/grpcurl/cmd/grpcurl@latest"
need_tool curl "Install curl to exercise the HTTP API."
need_tool jq "Install jq to parse smoke-test responses."
need_tool psql "Install postgresql-client."
need_language_runtime_tool go go "Install Go 1.25+ where the runner child PATH can execute it."
need_language_runtime_tool bash bash "Install bash for bash/shell jobs."
need_language_runtime_tool cangjie cjc "Install the Cangjie SDK for Cangjie jobs."
need_language_runtime_tool clojure clojure "Install Clojure for Clojure jobs."
need_language_runtime_tool c gcc "Install gcc for C jobs."
need_language_runtime_tool cpp g++ "Install g++ for C++ jobs."
need_language_runtime_tool coq coqc "Install Coq for Coq jobs."
need_language_runtime_tool crystal crystal "Install Crystal for Crystal jobs."
need_language_runtime_tool dart dart "Install Dart SDK for Dart jobs."
need_language_runtime_tool elixir elixir "Install Elixir for Elixir jobs."
need_language_runtime_tool erlang erlc "Install Erlang compiler for Erlang jobs."
need_language_runtime_tool erlang erl "Install Erlang runtime for Erlang jobs."
need_language_runtime_tool fsharp dotnet "Install .NET SDK for F# jobs."
need_language_runtime_tool fortran gfortran "Install GNU Fortran for Fortran jobs."
need_language_runtime_tool gdscript godot3-server "Install Godot server for GDScript jobs."
need_language_runtime_tool gleam gleam "Install Gleam for Gleam jobs."
need_language_runtime_tool gleam erl "Install Erlang runtime for Gleam jobs."
need_language_runtime_tool graphviz dot "Install Graphviz for Graphviz DOT jobs."
need_language_runtime_tool haskell ghc "Install GHC for Haskell jobs."
need_language_runtime_tool java javac "Install OpenJDK for Java jobs."
need_language_runtime_tool java java "Install OpenJDK for Java jobs."
need_language_runtime_tool javascript node "Install Node.js for JavaScript jobs."
need_language_runtime_tool kotlin kotlinc "Install Kotlin compiler for Kotlin jobs."
need_language_runtime_tool kotlin java "Install OpenJDK for Kotlin jobs."
need_language_runtime_tool julia julia "Install Julia for Julia jobs."
need_language_runtime_tool latex tectonic "Install Tectonic for LaTeX jobs."
need_language_runtime_tool lean4 lean "Install Lean 4 for Lean jobs."
need_language_runtime_tool lua lua "Install Lua for Lua jobs."
need_language_runtime_tool lua luac "Install Lua compiler for Lua syntax checks."
need_language_runtime_tool markdown node "Install Node.js for Markdown jobs."
need_language_runtime_tool markdown mmdc "Install Mermaid CLI for Markdown Mermaid jobs."
need_language_runtime_tool mdx node "Install Node.js for MDX jobs."
need_language_runtime_tool mojo mojo "Install Mojo for Mojo jobs."
need_language_runtime_tool csharp mcs "Install Mono mcs for C# jobs."
need_language_runtime_tool csharp mono "Install Mono runtime for C# jobs."
need_language_runtime_tool nextflow nextflow "Install Nextflow for Nextflow jobs."
need_language_runtime_tool nextjs node "Install Node.js for Next.js jobs."
need_language_runtime_tool nim nim "Install Nim for Nim jobs."
need_language_runtime_tool octave octave-cli "Install GNU Octave for Octave jobs."
need_language_runtime_tool ocaml ocamlopt "Install OCaml native compiler for OCaml jobs."
need_language_runtime_tool pascal fpc "Install Free Pascal for Pascal jobs."
need_language_runtime_tool scss sass "Install Sass for SCSS jobs."
need_language_runtime_tool tsx esbuild "Install esbuild for TSX jobs."
need_language_runtime_tool tsx node "Install Node.js for TSX jobs."
need_language_runtime_tool vue3 esbuild "Install esbuild for Vue jobs."
need_language_runtime_tool vue3 node "Install Node.js for Vue jobs."
need_language_runtime_tool tailwindcss tailwindcss "Install Tailwind CSS CLI for Tailwind CSS jobs."
need_language_runtime_tool perl perl "Install Perl for Perl jobs."
need_language_runtime_tool php php "Install PHP CLI for PHP jobs."
need_language_runtime_tool prolog swipl "Install SWI-Prolog for Prolog jobs."
need_language_runtime_tool python python3 "Install Python 3 for Python jobs."
need_language_runtime_tool qml qml "Install Qt QML runtime for QML jobs."
need_language_runtime_tool qml /usr/lib/qt6/bin/qmllint "Install Qt 6 QML tooling for QML lint checks."
need_language_runtime_tool r Rscript "Install Rscript for R jobs."
need_language_runtime_tool racket racket "Install Racket for Racket jobs."
need_language_runtime_tool racket raco "Install Racket raco for Racket jobs."
need_language_runtime_tool ruby ruby "Install Ruby for Ruby jobs."
need_language_runtime_tool rust rustc "Install rustc for Rust jobs."
need_language_runtime_tool scala scala "Install Scala for Scala jobs."
need_language_runtime_tool scala scalac "Install Scalac for Scala jobs."
need_language_runtime_tool sql sqlite3 "Install SQLite CLI for SQL jobs."
need_language_runtime_tool swift swiftc "Install Swift for Swift jobs."
need_language_runtime_tool typst typst "Install Typst for Typst jobs."
need_language_runtime_tool typescript tsc "Install TypeScript compiler for TypeScript jobs."
need_language_runtime_tool typescript node "Install Node.js for TypeScript jobs."
need_language_runtime_tool wdl miniwdl "Install miniwdl for WDL jobs."
need_language_runtime_tool vlang v "Install V for V language jobs."
need_language_runtime_tool zig zig "Install Zig for Zig jobs."

ensure_listen_address_free "gRPC" "$API_ADDR"
ensure_listen_address_free "HTTP" "$HTTP_ADDR"
ensure_no_existing_runner

printf 'Checking database connectivity...\n'
psql "$DB_URL" -v ON_ERROR_STOP=1 -c 'select 1' >/dev/null

printf 'Loading schema...\n'
psql "$DB_URL" -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
DROP TABLE IF EXISTS job_events CASCADE;
DROP TABLE IF EXISTS job_artifacts CASCADE;
DROP TABLE IF EXISTS job_attempts CASCADE;
DROP TABLE IF EXISTS jobs CASCADE;
DROP TYPE IF EXISTS job_status CASCADE;
SQL
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$ROOT/speicher/schema.sql" >/dev/null
psql "$DB_URL" -v ON_ERROR_STOP=1 -c 'truncate job_events, job_artifacts, job_attempts, jobs restart identity cascade;' >/dev/null

printf 'Building API and runner...\n'
(cd "$ROOT/schnittstelle" && go build -trimpath -o /tmp/sandkasten-api-smoke-languages ./cmd/sandkasten-api)
(cd "$ROOT/laeufer" && cargo build --bin laeufer >/dev/null)

printf 'Starting API on %s / HTTP %s...\n' "$API_ADDR" "$HTTP_ADDR"
DATABASE_URL="$DB_URL" \
SANDKASTEN_API_TOKEN="$API_TOKEN" \
SANDKASTEN_API_GRPC_ADDR="$API_ADDR" \
SANDKASTEN_API_HTTP_ADDR="$HTTP_ADDR" \
SANDKASTEN_API_CORS_ORIGINS="http://localhost:5173,http://127.0.0.1:5173,https://diewehmut.github.io" \
  /tmp/sandkasten-api-smoke-languages >/tmp/sandkasten-api-smoke-languages.log 2>&1 &
api_pid="$!"

api_ready=0
for _ in {1..50}; do
  if ! kill -0 "$api_pid" >/dev/null 2>&1; then
    printf 'API exited during startup; log follows:\n' >&2
    cat /tmp/sandkasten-api-smoke-languages.log >&2
    exit 1
  fi
  if grpcurl -plaintext \
    -H "authorization: Bearer ${API_TOKEN}" \
    -import-path "$ROOT/vertrag" \
    -proto sandkasten/v1/runtime.proto \
    "$API_ADDR" \
    sandkasten.v1.RuntimeService/ListRuntimes >/dev/null 2>&1; then
    api_ready=1
    break
  fi
  sleep 0.2
done

if [[ "$api_ready" -ne 1 ]]; then
  printf 'API did not become ready; log follows:\n' >&2
  cat /tmp/sandkasten-api-smoke-languages.log >&2
  exit 1
fi

printf 'Starting runner...\n'
rm -rf "$RUNNER_WORK_DIR"
DATABASE_URL="$DB_URL" \
LAEUFER_RUNNER_ID=smoke-languages \
LAEUFER_WORK_DIR="$RUNNER_WORK_DIR" \
LAEUFER_POLL_INTERVAL_MS=200 \
LAEUFER_LEASE_TTL_MS=60000 \
LAEUFER_CGROUP_ROOT="${LAEUFER_CGROUP_ROOT:-/sys/fs/cgroup}" \
LAEUFER_REQUIRE_PRIVATE_NAMESPACES="${LAEUFER_REQUIRE_PRIVATE_NAMESPACES:-1}" \
LAEUFER_COMPILE_MEMORY_LIMIT_BYTES="$COMPILE_MEMORY_LIMIT_BYTES" \
LAEUFER_RUNTIME_PATH="$RUNTIME_PATH" \
LAEUFER_CHILD_UID="${LAEUFER_CHILD_UID:-65534}" \
LAEUFER_CHILD_GID="${LAEUFER_CHILD_GID:-65534}" \
  "$ROOT/laeufer/target/debug/laeufer" >/tmp/sandkasten-runner-smoke-languages.log 2>&1 &
runner_pid="$!"

sleep 1
if ! kill -0 "$runner_pid" >/dev/null 2>&1; then
  printf 'runner exited during startup; log follows:\n' >&2
  cat /tmp/sandkasten-runner-smoke-languages.log >&2
  exit 1
fi

run_language go "hello, go" 'package main
import "fmt"
func main(){fmt.Println("hello, go")}'

run_language bash "hello, bash" 'printf "%s\n" "hello, bash"'

run_language cangjie "hello, cangjie" 'main() {
    println("hello, cangjie")
}' 1073741824

run_language clojure "hello, clojure" '(println "hello, clojure")'

run_language css "main { color: #0f766e; }" 'main { color: #0f766e; }'

run_language c "hello, c" '#include <stdio.h>
int main(void){puts("hello, c");return 0;}'

run_language cpp "hello, cpp" '#include <iostream>
int main(){std::cout << "hello, cpp\n"; return 0;}'

run_language csharp "hello, csharp" 'using System;
class Program { static void Main() { Console.WriteLine("hello, csharp"); } }'

run_language coq "" 'Goal True. Proof. exact I. Qed.'

run_language crystal "hello, crystal" 'puts "hello, crystal"'

run_language dart "hello, dart" 'void main() {
  print("hello, dart");
}' 1073741824

run_language elixir "hello, elixir" 'IO.puts("hello, elixir")'

run_language erlang "hello, erlang" '-module(main).
-export([main/0]).
main() -> io:format("hello, erlang~n", []).'

run_language fsharp "hello, fsharp" 'printfn "hello, fsharp"' 1073741824

run_language fortran " hello, fortran" 'program main
  print *, "hello, fortran"
end program main' 1073741824

run_language gdscript "hello, gdscript" 'extends SceneTree
func _init():
    print("hello, gdscript")
    quit()' 1073741824

run_language gleam "hello, gleam" 'import gleam/io

pub fn main() {
  io.println("hello, gleam")
}' 1073741824

run_language_contains graphviz "<svg" 'digraph G {
  hello -> graphviz;
}'

run_language haskell "hello, haskell" 'main :: IO ()
main = putStrLn "hello, haskell"' 1073741824

run_language html "<main>Hello, HTML</main>" '<main>Hello, HTML</main>'

run_language java "hello, java" 'public class Main {
  public static void main(String[] args) { System.out.println("hello, java"); }
}'

run_language javascript "hello, javascript" 'console.log("hello, javascript");'

run_language julia "hello, julia" 'println("hello, julia")'

run_language kotlin "hello, kotlin" 'fun main() {
    println("hello, kotlin")
}'

run_language latex "latex compiled" '\documentclass{article}
\begin{document}
hello, latex
\end{document}' 1073741824

run_language lean4 "hello, lean4" 'def main : IO Unit := IO.println "hello, lean4"'

run_language lua "hello, lua" 'print("hello, lua")'

run_language_contains markdown "<h1>hello, markdown</h1>" '# hello, markdown

```mermaid
graph TD; A-->B;
```' 1073741824

run_language_contains mdx "<h1>hello, mdx</h1>" '# hello, mdx

<strong>static mdx</strong>' 1073741824

run_language mojo "hello, mojo" 'def main():
    print("hello, mojo")' 1073741824

run_language_contains nextjs "<main>Hello, Next</main>" 'export default function Page() {
  return <main>Hello, Next</main>;
}' 1073741824

run_language nextflow "hello, nextflow" 'workflow {
  println "hello, nextflow"
}' 1073741824

run_language nim "hello, nim" 'echo "hello, nim"'

run_language octave "hello, octave" 'disp("hello, octave")'

run_language ocaml "hello, ocaml" 'print_endline "hello, ocaml"'

run_language pascal "hello, pascal" 'program main;
begin
  writeln('"'"'hello, pascal'"'"');
end.'

# shellcheck disable=SC2016
run_language assembly "" '.global main
main:
  mov $0, %eax
  ret'

run_language perl "hello, perl" 'print "hello, perl\n";'

run_language php "hello, php" '<?php echo "hello, php\n";'

run_language prolog "hello, prolog" 'main :- writeln("hello, prolog").'

run_language python "hello, python" 'print("hello, python")'

run_language qml "hello, qml" 'import QtQml 2.15
QtObject {
    Component.onCompleted: {
        console.log("hello, qml")
        Qt.quit()
    }
}' 1073741824

run_language r "hello, r" 'cat("hello, r\n")'

run_language racket "hello, racket" '#lang racket/base
(displayln "hello, racket")'

run_language ruby "hello, ruby" 'puts "hello, ruby"'

run_language rust "hello, rust" 'fn main() { println!("hello, rust"); }'

run_language scala "hello, scala" 'object Main extends App {
  println("hello, scala")
}' 1073741824

# shellcheck disable=SC2016
run_language scss ".button {
  color: #0f766e;
}" '$color: #0f766e;
.button { color: $color; }'

run_language sql "hello, sql" "select 'hello, sql';"

run_language swift "hello, swift" 'print("hello, swift")' 1073741824

run_language_contains tailwindcss ".text-red-500{" '/* text-red-500 font-bold */
@tailwind utilities;'

run_language_contains typst "<svg" '= hello, typst' 1073741824

run_language typescript "hello, typescript" 'const msg: string = "hello, typescript";
console.log(msg);'

run_language tsx "<main>Hello, TSX</main>" 'export default function App() {
  return <main>Hello, TSX</main>;
}'

run_language vue3 "<style>.greeting { color: teal; }</style><main class=\"greeting\">Hello, Vue</main>" '<template><main class="greeting">Hello, Vue</main></template>
<style>.greeting { color: teal; }</style>'

run_language vlang "hello, vlang" "fn main() {
  println('hello, vlang')
}"

run_language wdl "hello, wdl" 'version 1.0
workflow hello {
  output {
    String message = "hello, wdl"
  }
}'

run_language zig "hello, zig" 'extern fn write(fd: i32, buf: [*]const u8, count: usize) isize;
pub fn main() void {
    const msg = "hello, zig\n";
    _ = write(1, msg.ptr, msg.len);
}' 1073741824

printf 'language smoke passed\n'
