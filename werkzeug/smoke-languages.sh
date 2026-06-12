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

json_string() {
  jq -Rs .
}

run_language() {
  local language="$1"
  local expected="$2"
  local source="$3"
  local memory="${4:-805306368}"
  local source_json
  source_json="$(printf '%s' "$source" | json_string)"

  printf 'Submitting %s example...\n' "$language"
  local response
  response="$(
    curl -fsS \
      -H "authorization: Bearer ${API_TOKEN}" \
      -H 'content-type: application/json' \
      -d "{\"source\":${source_json},\"wait\":true,\"waitTimeoutMs\":60000,\"compileTimeoutMs\":60000,\"runTimeoutMs\":10000,\"memoryLimitBytes\":${memory},\"maxOutputBytes\":1048576}" \
      "http://${HTTP_ADDR}/v1/${language}/run"
  )"
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
  local expected_fragment="$2"
  local source="$3"
  local memory="${4:-805306368}"
  local source_json
  source_json="$(printf '%s' "$source" | json_string)"

  printf 'Submitting %s example...\n' "$language"
  local response
  response="$(
    curl -fsS \
      -H "authorization: Bearer ${API_TOKEN}" \
      -H 'content-type: application/json' \
      -d "{\"source\":${source_json},\"wait\":true,\"waitTimeoutMs\":60000,\"compileTimeoutMs\":60000,\"runTimeoutMs\":10000,\"memoryLimitBytes\":${memory},\"maxOutputBytes\":1048576}" \
      "http://${HTTP_ADDR}/v1/${language}/run"
  )"
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
need_runtime_tool go "Install Go 1.25+ where the runner child PATH can execute it."
need_runtime_tool bash "Install bash for bash/shell jobs."
need_runtime_tool cjc "Install the Cangjie SDK for Cangjie jobs."
need_runtime_tool clojure "Install Clojure for Clojure jobs."
need_runtime_tool gcc "Install gcc for C jobs."
need_runtime_tool g++ "Install g++ for C++ jobs."
need_runtime_tool coqc "Install Coq for Coq jobs."
need_runtime_tool crystal "Install Crystal for Crystal jobs."
need_runtime_tool dart "Install Dart SDK for Dart jobs."
need_runtime_tool elixir "Install Elixir for Elixir jobs."
need_runtime_tool erlc "Install Erlang compiler for Erlang jobs."
need_runtime_tool erl "Install Erlang runtime for Erlang jobs."
need_runtime_tool dotnet "Install .NET SDK for F# jobs."
need_runtime_tool godot3-server "Install Godot server for GDScript jobs."
need_runtime_tool ghc "Install GHC for Haskell jobs."
need_runtime_tool javac "Install OpenJDK for Java jobs."
need_runtime_tool java "Install OpenJDK for Java jobs."
need_runtime_tool kotlinc "Install Kotlin compiler for Kotlin jobs."
need_runtime_tool julia "Install Julia for Julia jobs."
need_runtime_tool lean "Install Lean 4 for Lean jobs."
need_runtime_tool lua "Install Lua for Lua jobs."
need_runtime_tool luac "Install Lua compiler for Lua syntax checks."
need_runtime_tool mojo "Install Mojo for Mojo jobs."
need_runtime_tool mcs "Install Mono mcs for C# jobs."
need_runtime_tool mono "Install Mono runtime for C# jobs."
need_runtime_tool nextflow "Install Nextflow for Nextflow jobs."
need_runtime_tool nim "Install Nim for Nim jobs."
need_runtime_tool node "Install Node.js for JavaScript jobs."
need_runtime_tool sass "Install Sass for SCSS jobs."
need_runtime_tool esbuild "Install esbuild for TSX/Vue jobs."
need_runtime_tool tailwindcss "Install Tailwind CSS CLI for Tailwind CSS jobs."
need_runtime_tool perl "Install Perl for Perl jobs."
need_runtime_tool php "Install PHP CLI for PHP jobs."
need_runtime_tool swipl "Install SWI-Prolog for Prolog jobs."
need_runtime_tool python3 "Install Python 3 for Python jobs."
need_runtime_tool qml "Install Qt QML runtime for QML jobs."
need_runtime_tool /usr/lib/qt6/bin/qmllint "Install Qt 6 QML tooling for QML lint checks."
need_runtime_tool Rscript "Install Rscript for R jobs."
need_runtime_tool racket "Install Racket for Racket jobs."
need_runtime_tool raco "Install Racket raco for Racket jobs."
need_runtime_tool ruby "Install Ruby for Ruby jobs."
need_runtime_tool rustc "Install rustc for Rust jobs."
need_runtime_tool scala "Install Scala for Scala jobs."
need_runtime_tool scalac "Install Scalac for Scala jobs."
need_runtime_tool sqlite3 "Install SQLite CLI for SQL jobs."
need_runtime_tool swiftc "Install Swift for Swift jobs."
need_runtime_tool tsc "Install TypeScript compiler for TypeScript jobs."
need_runtime_tool miniwdl "Install miniwdl for WDL jobs."
need_runtime_tool zig "Install Zig for Zig jobs."

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

for _ in {1..50}; do
  if grpcurl -plaintext \
    -H "authorization: Bearer ${API_TOKEN}" \
    -import-path "$ROOT/vertrag" \
    -proto sandkasten/v1/runtime.proto \
    "$API_ADDR" \
    sandkasten.v1.RuntimeService/ListRuntimes >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

if ! grpcurl -plaintext \
  -H "authorization: Bearer ${API_TOKEN}" \
  -import-path "$ROOT/vertrag" \
  -proto sandkasten/v1/runtime.proto \
  "$API_ADDR" \
  sandkasten.v1.RuntimeService/ListRuntimes >/dev/null 2>&1; then
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

run_language gdscript "hello, gdscript" 'extends SceneTree
func _init():
    print("hello, gdscript")
    quit()' 1073741824

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

run_language lean4 "hello, lean4" 'def main : IO Unit := IO.println "hello, lean4"'

run_language lua "hello, lua" 'print("hello, lua")'

run_language mojo "hello, mojo" 'def main():
    print("hello, mojo")' 1073741824

run_language_contains nextjs "<main>Hello, Next</main>" 'export default function Page() {
  return <main>Hello, Next</main>;
}' 1073741824

run_language nextflow "hello, nextflow" 'workflow {
  println "hello, nextflow"
}' 1073741824

run_language nim "hello, nim" 'echo "hello, nim"'

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

run_language typescript "hello, typescript" 'const msg: string = "hello, typescript";
console.log(msg);'

run_language tsx "<main>Hello, TSX</main>" 'export default function App() {
  return <main>Hello, TSX</main>;
}'

run_language vue3 "<style>.greeting { color: teal; }</style><main class=\"greeting\">Hello, Vue</main>" '<template><main class="greeting">Hello, Vue</main></template>
<style>.greeting { color: teal; }</style>'

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

printf 'multi-language smoke passed\n'
