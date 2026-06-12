use laeufer_core::{BuildPlan, Job};
use std::path::PathBuf;

use crate::constants::{RUNNER_BIN_DIR, RUNNER_TMP_DIR};
use crate::planner::common::{compile_command_plan, run_command_plan, PhaseBudget};

const JULIA_SYNTAX_CHECK: &str = "function has_parse_error(x); x isa Expr && (x.head in (:error, :incomplete) || any(has_parse_error, x.args)); end; ex = Meta.parseall(read(ARGS[1], String)); has_parse_error(ex) && (println(stderr, \"Julia syntax error\"); exit(1))";
const CHECK_READABLE_SCRIPT: &str = "test -r \"$1\"";
const HTML_SYNTAX_CHECK: &str = r#"const fs = require('fs'); const source = fs.readFileSync(process.argv[1], 'utf8'); if (!/<[a-zA-Z][\s\S]*>/.test(source)) { console.error('HTML source must contain at least one element tag'); process.exit(1); }"#;
const CSS_SYNTAX_CHECK: &str = r#"const fs = require('fs'); const postcss = require('postcss'); postcss.parse(fs.readFileSync(process.argv[1], 'utf8'), { from: process.argv[1] });"#;
const ELIXIR_SYNTAX_CHECK: &str =
    "path = List.first(System.argv()); Code.string_to_quoted!(File.read!(path), file: path)";
const PROLOG_SYNTAX_CHECK: &str = "current_prolog_flag(argv, [Path|_]), setup_call_cleanup(open(Path, read, S, [encoding(utf8)]), (repeat, read_term(S, Term, [syntax_errors(error)]), (Term == end_of_file -> ! ; fail)), close(S)), halt.";
const SQLITE_RUN_SCRIPT: &str = "exec sqlite3 -batch -bail -safe :memory: < \"$1\"";
const TAILWIND_BUILD_SCRIPT: &str = r#"set -eu
entrypoint="$1"
mkdir -p .laeufer-bin
tailwindcss -i "$entrypoint" -o .laeufer-bin/main.css --content "./**/*.{html,js,jsx,ts,tsx,vue,css}" --minify >/dev/null
"#;
const TSX_BUILD_SCRIPT: &str = r#"set -eu
entrypoint="$1"
mkdir -p .laeufer-cache/tsx .laeufer-bin
esbuild "$entrypoint" --bundle --platform=node --format=cjs --jsx=automatic --outfile=.laeufer-cache/tsx/component.cjs >/dev/null
cat > .laeufer-cache/tsx/entry.cjs <<'NODE'
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const componentModule = require('./component.cjs');

const Component = componentModule.default || componentModule.App || componentModule.Component;
if (typeof Component === 'function') {
  const props = {};
  let rendered = Component(props);
  if (rendered && typeof rendered.then === 'function') {
    rendered
      .then((element) => process.stdout.write(renderToStaticMarkup(element) + '\n'))
      .catch((error) => { console.error(error && error.stack ? error.stack : error); process.exit(1); });
  } else {
    const element = React.isValidElement(rendered) ? rendered : React.createElement(Component, props);
    process.stdout.write(renderToStaticMarkup(element) + '\n');
  }
}
NODE
esbuild .laeufer-cache/tsx/entry.cjs --bundle --platform=node --format=cjs --outfile=.laeufer-bin/main.cjs >/dev/null
"#;
const VUE_BUILD_SCRIPT: &str = r#"set -eu
entrypoint="$1"
mkdir -p .laeufer-cache/vue .laeufer-bin
node - "$entrypoint" <<'NODE'
const fs = require('fs');
const { parse, compileScript, compileTemplate, rewriteDefault } = require('@vue/compiler-sfc');

const entry = process.argv[2];
const parsed = parse(fs.readFileSync(entry, 'utf8'), { filename: entry });
if (parsed.errors && parsed.errors.length) {
  for (const error of parsed.errors) console.error(error.message || String(error));
  process.exit(1);
}

const descriptor = parsed.descriptor;
let script = 'const __sfc__ = {};';
if (descriptor.script || descriptor.scriptSetup) {
  const compiled = compileScript(descriptor, {
    id: 'sandkasten-vue',
    inlineTemplate: true,
    templateOptions: { ssr: true },
  });
  script = rewriteDefault(compiled.content, '__sfc__');
} else if (descriptor.template) {
  const compiledTemplate = compileTemplate({
    source: descriptor.template.content,
    filename: entry,
    id: 'sandkasten-vue',
    ssr: true,
    cssVars: [],
    compilerOptions: { scopeId: descriptor.styles.some((style) => style.scoped) ? 'data-v-sandkasten-vue' : undefined },
  });
  if (compiledTemplate.errors && compiledTemplate.errors.length) {
    for (const error of compiledTemplate.errors) console.error(error.message || String(error));
    process.exit(1);
  }
  const templateCode = compiledTemplate.code.replace('export function ssrRender', 'function ssrRender');
  script = `${templateCode}
const __sfc__ = { ssrRender };`;
}
const style = descriptor.styles.map((block) => block.content).join('\n');
const output = `
import { createSSRApp } from 'vue';
import { renderToString } from '@vue/server-renderer';
${script}
;
(async () => {
  const html = await renderToString(createSSRApp(__sfc__));
  const style = ${JSON.stringify(style)};
  process.stdout.write((style ? '<style>' + style + '</style>' : '') + html + ${JSON.stringify('\n')});
})().catch((error) => { console.error(error && error.stack ? error.stack : error); process.exit(1); });
`;
fs.writeFileSync('.laeufer-cache/vue/entry.mjs', output);
NODE
esbuild .laeufer-cache/vue/entry.mjs --bundle --platform=node --format=cjs --outfile=.laeufer-bin/vue.cjs >/dev/null
"#;
const NEXTJS_BUILD_SCRIPT: &str = r#"set -eu
entrypoint="$1"
mkdir -p .laeufer-cache/next .laeufer-bin
node - "$entrypoint" <<'NODE'
const fs = require('fs');
const path = require('path');

const entrypoint = process.argv[2];
let importPath = path.relative('.laeufer-cache/next', entrypoint).replace(/\\/g, '/');
if (!importPath.startsWith('.')) importPath = './' + importPath;

const output = [
  "const React = require('react');",
  "const { renderToStaticMarkup } = require('react-dom/server');",
  "const page = require(" + JSON.stringify(importPath) + ");",
  "",
  "(async () => {",
  "  const Page = page.default || page.Page || page;",
  "  if (typeof Page !== 'function') {",
  "    throw new Error('Next.js page module must export a default component function');",
  "  }",
  "  const props = { params: {}, searchParams: {} };",
  "  let rendered = Page(props);",
  "  if (rendered && typeof rendered.then === 'function') rendered = await rendered;",
  "  const body = React.isValidElement(rendered)",
  "    ? renderToStaticMarkup(rendered)",
  "    : renderToStaticMarkup(React.createElement(Page, props));",
  "  process.stdout.write('<!DOCTYPE html><html><body>' + body + '</body></html>\\n');",
  "})().catch((error) => { console.error(error && error.stack ? error.stack : error); process.exit(1); });",
  "",
].join('\n');

fs.writeFileSync('.laeufer-cache/next/entry.cjs', output);
NODE
esbuild .laeufer-cache/next/entry.cjs --bundle --platform=node --format=cjs --jsx=automatic --outfile=.laeufer-bin/next.cjs >/dev/null
"#;
const WDL_RUN_SCRIPT: &str = r#"set -eu
entrypoint="$1"
mkdir -p .laeufer-cache
rm -rf .laeufer-cache/wdl-run .laeufer-cache/wdl-output.json
miniwdl run --no-color --no-outside-imports --dir .laeufer-cache/wdl-run -o .laeufer-cache/wdl-output.json "$entrypoint" >/dev/null
python3 - .laeufer-cache/wdl-output.json <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    outputs = json.load(handle).get("outputs", {})

for key in sorted(outputs):
    value = outputs[key]
    if isinstance(value, str):
        print(value)
PY
"#;
const NEXTFLOW_RUN_SCRIPT: &str = r#"set -eu
entrypoint="$1"
mkdir -p .laeufer-cache/nextflow .laeufer-cache/nextflow-work
nextflow run "$entrypoint" -ansi-log false -offline -without-docker -without-podman -without-conda -without-spack -work-dir .laeufer-cache/nextflow-work > .laeufer-cache/nextflow/stdout 2> .laeufer-cache/nextflow/stderr
python3 - .laeufer-cache/nextflow/stdout <<'PY'
import sys

for line in open(sys.argv[1], encoding="utf-8", errors="replace"):
    stripped = line.strip()
    if not stripped:
        continue
    if stripped.startswith("N E X T F L O W") or stripped.startswith("Launching `"):
        continue
    print(line, end="")
PY
"#;
const GDSCRIPT_RUN_SCRIPT: &str = r#"set -eu
entrypoint="$1"
mkdir -p .laeufer-cache/gdscript .laeufer-tmp/godot-home .laeufer-tmp/godot-tmp
export HOME="$PWD/.laeufer-tmp/godot-home"
export TMPDIR="$PWD/.laeufer-tmp/godot-tmp"
stdout=.laeufer-cache/gdscript/stdout
stderr=.laeufer-cache/gdscript/stderr
if ! godot3-server --no-window --disable-crash-handler --path . -s "$entrypoint" >"$stdout" 2>"$stderr"; then
    cat "$stdout" >&2
    cat "$stderr" >&2
    exit 1
fi
python3 - "$stdout" <<'PY'
import sys

skip_banner_spacing = False
for line in open(sys.argv[1], encoding="utf-8", errors="replace"):
    if line.startswith("Godot Engine v"):
        skip_banner_spacing = True
        continue
    if skip_banner_spacing and not line.strip():
        skip_banner_spacing = False
        continue
    skip_banner_spacing = False
    print(line, end="")
PY
"#;
const QML_RUN_SCRIPT: &str = r#"set -eu
entrypoint="$1"
mkdir -p .laeufer-cache/qml .laeufer-tmp
export XDG_RUNTIME_DIR="$PWD/.laeufer-tmp/qml-runtime"
umask 077
mkdir -p "$XDG_RUNTIME_DIR"
stdout=.laeufer-cache/qml/stdout
stderr=.laeufer-cache/qml/stderr
status=0
qml "$entrypoint" >"$stdout" 2>"$stderr" || status=$?
if [ "$status" -ne 0 ] && ! python3 - "$status" "$stdout" "$stderr" <<'PY'
import sys

status = int(sys.argv[1])
stdout = open(sys.argv[2], encoding="utf-8", errors="replace").read().splitlines()
stderr = open(sys.argv[3], encoding="utf-8", errors="replace").read().splitlines()

known_stdout = all(not line or line == "qml: Did not load any objects, exiting." for line in stdout)
console_only = all((not line) or line.startswith("qml: ") for line in stderr)
sys.exit(0 if status == 2 and known_stdout and console_only else 1)
PY
then
    cat "$stdout" >&2
    cat "$stderr" >&2
    exit 1
fi
python3 - "$stdout" "$stderr" <<'PY'
import sys

for path in sys.argv[1:]:
    with open(path, encoding="utf-8", errors="replace") as handle:
        for line in handle:
            stripped = line.rstrip("\n")
            if stripped == "qml: Did not load any objects, exiting.":
                continue
            if stripped.startswith("qml: "):
                print(stripped[5:])
PY
"#;

pub(in crate::planner) fn plan_bash(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
) -> BuildPlan {
    let entrypoint = entrypoint.to_string_lossy().into_owned();
    let compile = compile_command_plan(
        "bash",
        vec!["-n".to_owned(), entrypoint.clone()],
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );
    let mut run_args = vec!["--noprofile".to_owned(), "--norc".to_owned(), entrypoint];
    run_args.extend(job.args.clone());
    let run = run_command_plan(
        "bash",
        run_args,
        env,
        source_dir,
        job.stdin.clone(),
        PhaseBudget {
            timeout: job.limits.run_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );

    BuildPlan { compile, run }
}

pub(in crate::planner) fn plan_javascript(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
) -> BuildPlan {
    let entrypoint = entrypoint.to_string_lossy().into_owned();
    let compile = compile_command_plan(
        "node",
        vec!["--check".to_owned(), entrypoint.clone()],
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );
    let mut run_args = vec![entrypoint];
    run_args.extend(job.args.clone());
    let run = run_command_plan(
        "node",
        run_args,
        env,
        source_dir,
        job.stdin.clone(),
        PhaseBudget {
            timeout: job.limits.run_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );

    BuildPlan { compile, run }
}

pub(in crate::planner) fn plan_html(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
) -> BuildPlan {
    let entrypoint = entrypoint.to_string_lossy().into_owned();
    let compile = compile_command_plan(
        "node",
        vec![
            "-e".to_owned(),
            HTML_SYNTAX_CHECK.to_owned(),
            entrypoint.clone(),
        ],
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );
    let run = run_command_plan(
        "cat",
        vec![entrypoint],
        env,
        source_dir,
        Default::default(),
        PhaseBudget {
            timeout: job.limits.run_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );

    BuildPlan { compile, run }
}

pub(in crate::planner) fn plan_css(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
) -> BuildPlan {
    let entrypoint = entrypoint.to_string_lossy().into_owned();
    let compile = compile_command_plan(
        "node",
        vec![
            "-e".to_owned(),
            CSS_SYNTAX_CHECK.to_owned(),
            entrypoint.clone(),
        ],
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );
    let run = run_command_plan(
        "cat",
        vec![entrypoint],
        env,
        source_dir,
        Default::default(),
        PhaseBudget {
            timeout: job.limits.run_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );

    BuildPlan { compile, run }
}

pub(in crate::planner) fn plan_scss(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
) -> BuildPlan {
    let entrypoint = entrypoint.to_string_lossy().into_owned();
    let output = format!("{RUNNER_BIN_DIR}/main.css");
    let compile = compile_command_plan(
        "sass",
        vec!["--no-source-map".to_owned(), entrypoint, output.clone()],
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );
    let run = run_command_plan(
        "cat",
        vec![output],
        env,
        source_dir,
        Default::default(),
        PhaseBudget {
            timeout: job.limits.run_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );

    BuildPlan { compile, run }
}

pub(in crate::planner) fn plan_tailwindcss(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
) -> BuildPlan {
    let entrypoint = entrypoint.to_string_lossy().into_owned();
    let output = format!("{RUNNER_BIN_DIR}/main.css");
    let compile = compile_command_plan(
        "bash",
        vec![
            "--noprofile".to_owned(),
            "--norc".to_owned(),
            "-c".to_owned(),
            TAILWIND_BUILD_SCRIPT.to_owned(),
            "_".to_owned(),
            entrypoint,
        ],
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );
    let run = run_command_plan(
        "cat",
        vec![output],
        env,
        source_dir,
        Default::default(),
        PhaseBudget {
            timeout: job.limits.run_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );

    BuildPlan { compile, run }
}

pub(in crate::planner) fn plan_tsx(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
) -> BuildPlan {
    let entrypoint = entrypoint.to_string_lossy().into_owned();
    let compile = compile_command_plan(
        "bash",
        vec![
            "--noprofile".to_owned(),
            "--norc".to_owned(),
            "-c".to_owned(),
            TSX_BUILD_SCRIPT.to_owned(),
            "_".to_owned(),
            entrypoint,
        ],
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );
    let mut run_args = vec![format!("{RUNNER_BIN_DIR}/main.cjs")];
    run_args.extend(job.args.clone());
    let run = run_command_plan(
        "node",
        run_args,
        env,
        source_dir,
        job.stdin.clone(),
        PhaseBudget {
            timeout: job.limits.run_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );

    BuildPlan { compile, run }
}

pub(in crate::planner) fn plan_vue3(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
) -> BuildPlan {
    let entrypoint = entrypoint.to_string_lossy().into_owned();
    let compile = compile_command_plan(
        "bash",
        vec![
            "--noprofile".to_owned(),
            "--norc".to_owned(),
            "-c".to_owned(),
            VUE_BUILD_SCRIPT.to_owned(),
            "_".to_owned(),
            entrypoint,
        ],
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );
    let run = run_command_plan(
        "node",
        vec![format!("{RUNNER_BIN_DIR}/vue.cjs")],
        env,
        source_dir,
        job.stdin.clone(),
        PhaseBudget {
            timeout: job.limits.run_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );

    BuildPlan { compile, run }
}

pub(in crate::planner) fn plan_nextjs(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
) -> BuildPlan {
    let entrypoint = entrypoint.to_string_lossy().into_owned();
    let compile = compile_command_plan(
        "bash",
        vec![
            "--noprofile".to_owned(),
            "--norc".to_owned(),
            "-c".to_owned(),
            NEXTJS_BUILD_SCRIPT.to_owned(),
            "_".to_owned(),
            entrypoint,
        ],
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );
    let run = run_command_plan(
        "node",
        vec![format!("{RUNNER_BIN_DIR}/next.cjs")],
        env,
        source_dir,
        job.stdin.clone(),
        PhaseBudget {
            timeout: job.limits.run_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );

    BuildPlan { compile, run }
}

pub(in crate::planner) fn plan_clojure(
    job: &Job,
    source_dir: PathBuf,
    mut env: Vec<(String, String)>,
    entrypoint: PathBuf,
) -> BuildPlan {
    env.push((
        "JAVA_TOOL_OPTIONS".to_owned(),
        format!(
            "-XX:ActiveProcessorCount=1 -Djava.io.tmpdir={}",
            source_dir.join(RUNNER_TMP_DIR).to_string_lossy()
        ),
    ));

    let entrypoint = entrypoint.to_string_lossy().into_owned();
    let compile = compile_command_plan(
        "clojure",
        vec!["-e".to_owned(), clojure_syntax_check_script(&entrypoint)],
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );
    let mut run_args = vec![entrypoint];
    run_args.extend(job.args.clone());
    let run = run_command_plan(
        "clojure",
        run_args,
        env,
        source_dir,
        job.stdin.clone(),
        PhaseBudget {
            timeout: job.limits.run_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );

    BuildPlan { compile, run }
}

pub(in crate::planner) fn plan_elixir(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
) -> BuildPlan {
    let entrypoint = entrypoint.to_string_lossy().into_owned();
    let compile = compile_command_plan(
        "elixir",
        vec![
            "--erl".to_owned(),
            "+S 1".to_owned(),
            "-e".to_owned(),
            ELIXIR_SYNTAX_CHECK.to_owned(),
            "--".to_owned(),
            entrypoint.clone(),
        ],
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );
    let mut run_args = vec!["--erl".to_owned(), "+S 1".to_owned(), entrypoint];
    run_args.extend(job.args.clone());
    let run = run_command_plan(
        "elixir",
        run_args,
        env,
        source_dir,
        job.stdin.clone(),
        PhaseBudget {
            timeout: job.limits.run_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );

    BuildPlan { compile, run }
}

fn clojure_syntax_check_script(entrypoint: &str) -> String {
    format!(
        "(let [path {}] (binding [*read-eval* false] (with-open [r (java.io.PushbackReader. (clojure.java.io/reader path))] (loop [] (let [x (read r false ::eof)] (when-not (= x ::eof) (recur)))))))",
        clojure_string_literal(entrypoint)
    )
}

fn clojure_string_literal(value: &str) -> String {
    let mut output = String::with_capacity(value.len() + 2);
    output.push('"');
    for char in value.chars() {
        match char {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            char if char.is_control() => output.push_str(&format!("\\u{:04x}", char as u32)),
            char => output.push(char),
        }
    }
    output.push('"');
    output
}

pub(in crate::planner) fn plan_julia(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
) -> BuildPlan {
    let entrypoint = entrypoint.to_string_lossy().into_owned();
    let compile = compile_command_plan(
        "julia",
        vec![
            "--startup-file=no".to_owned(),
            "--history-file=no".to_owned(),
            "--compile=min".to_owned(),
            "--optimize=0".to_owned(),
            "-e".to_owned(),
            JULIA_SYNTAX_CHECK.to_owned(),
            entrypoint.clone(),
        ],
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );
    let mut run_args = vec![
        "--startup-file=no".to_owned(),
        "--history-file=no".to_owned(),
        "--compile=min".to_owned(),
        "--optimize=0".to_owned(),
        entrypoint,
    ];
    run_args.extend(job.args.clone());
    let run = run_command_plan(
        "julia",
        run_args,
        env,
        source_dir,
        job.stdin.clone(),
        PhaseBudget {
            timeout: job.limits.run_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );

    BuildPlan { compile, run }
}

pub(in crate::planner) fn plan_lua(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
) -> BuildPlan {
    let entrypoint = entrypoint.to_string_lossy().into_owned();
    let compile = compile_command_plan(
        "luac",
        vec!["-p".to_owned(), entrypoint.clone()],
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );
    let mut run_args = vec![entrypoint];
    run_args.extend(job.args.clone());
    let run = run_command_plan(
        "lua",
        run_args,
        env,
        source_dir,
        job.stdin.clone(),
        PhaseBudget {
            timeout: job.limits.run_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );

    BuildPlan { compile, run }
}

pub(in crate::planner) fn plan_nextflow(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
) -> BuildPlan {
    let entrypoint = entrypoint.to_string_lossy().into_owned();
    let compile = compile_command_plan(
        "nextflow",
        vec!["lint".to_owned(), entrypoint.clone()],
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );
    let run = run_command_plan(
        "bash",
        vec![
            "--noprofile".to_owned(),
            "--norc".to_owned(),
            "-c".to_owned(),
            NEXTFLOW_RUN_SCRIPT.to_owned(),
            "_".to_owned(),
            entrypoint,
        ],
        env,
        source_dir,
        job.stdin.clone(),
        PhaseBudget {
            timeout: job.limits.run_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );

    BuildPlan { compile, run }
}

pub(in crate::planner) fn plan_qml(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
) -> BuildPlan {
    let entrypoint = entrypoint.to_string_lossy().into_owned();
    let compile = compile_command_plan(
        "/usr/lib/qt6/bin/qmllint",
        vec!["--ignore-settings".to_owned(), entrypoint.clone()],
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );
    let run = run_command_plan(
        "bash",
        vec![
            "--noprofile".to_owned(),
            "--norc".to_owned(),
            "-c".to_owned(),
            QML_RUN_SCRIPT.to_owned(),
            "_".to_owned(),
            entrypoint,
        ],
        env,
        source_dir,
        job.stdin.clone(),
        PhaseBudget {
            timeout: job.limits.run_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );

    BuildPlan { compile, run }
}

pub(in crate::planner) fn plan_gdscript(
    job: &Job,
    source_dir: PathBuf,
    mut env: Vec<(String, String)>,
    entrypoint: PathBuf,
) -> BuildPlan {
    env.retain(|(key, _)| key != "LANG" && key != "LC_ALL");
    env.push(("LANG".to_owned(), "en_US".to_owned()));

    let entrypoint = entrypoint.to_string_lossy().into_owned();
    let compile = compile_command_plan(
        "godot3-server",
        vec![
            "--no-window".to_owned(),
            "--disable-crash-handler".to_owned(),
            "--check-only".to_owned(),
            "--path".to_owned(),
            ".".to_owned(),
            "-s".to_owned(),
            entrypoint.clone(),
        ],
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );
    let run = run_command_plan(
        "bash",
        vec![
            "--noprofile".to_owned(),
            "--norc".to_owned(),
            "-c".to_owned(),
            GDSCRIPT_RUN_SCRIPT.to_owned(),
            "_".to_owned(),
            entrypoint,
        ],
        env,
        source_dir,
        job.stdin.clone(),
        PhaseBudget {
            timeout: job.limits.run_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );

    BuildPlan { compile, run }
}

pub(in crate::planner) fn plan_php(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
) -> BuildPlan {
    let entrypoint = entrypoint.to_string_lossy().into_owned();
    let compile = compile_command_plan(
        "php",
        vec![
            "-d".to_owned(),
            "variables_order=EGPCS".to_owned(),
            "-d".to_owned(),
            "opcache.enable_cli=0".to_owned(),
            "-l".to_owned(),
            entrypoint.clone(),
        ],
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );
    let mut run_args = vec![
        "-d".to_owned(),
        "variables_order=EGPCS".to_owned(),
        "-d".to_owned(),
        "opcache.enable_cli=0".to_owned(),
        entrypoint,
    ];
    run_args.extend(job.args.clone());
    let run = run_command_plan(
        "php",
        run_args,
        env,
        source_dir,
        job.stdin.clone(),
        PhaseBudget {
            timeout: job.limits.run_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );

    BuildPlan { compile, run }
}

pub(in crate::planner) fn plan_perl(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
) -> BuildPlan {
    let entrypoint = entrypoint.to_string_lossy().into_owned();
    let compile = compile_command_plan(
        "perl",
        vec!["-c".to_owned(), entrypoint.clone()],
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );
    let mut run_args = vec![entrypoint];
    run_args.extend(job.args.clone());
    let run = run_command_plan(
        "perl",
        run_args,
        env,
        source_dir,
        job.stdin.clone(),
        PhaseBudget {
            timeout: job.limits.run_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );

    BuildPlan { compile, run }
}

pub(in crate::planner) fn plan_prolog(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
) -> BuildPlan {
    let entrypoint = entrypoint.to_string_lossy().into_owned();
    let compile = compile_command_plan(
        "swipl",
        vec![
            "--no-packs".to_owned(),
            "-q".to_owned(),
            "-f".to_owned(),
            "none".to_owned(),
            "-g".to_owned(),
            PROLOG_SYNTAX_CHECK.to_owned(),
            "--".to_owned(),
            entrypoint.clone(),
        ],
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );
    let mut run_args = vec![
        "--no-packs".to_owned(),
        "-q".to_owned(),
        "-f".to_owned(),
        "none".to_owned(),
        "-s".to_owned(),
        entrypoint,
        "-g".to_owned(),
        "main".to_owned(),
        "-t".to_owned(),
        "halt".to_owned(),
    ];
    run_args.extend(job.args.clone());
    let run = run_command_plan(
        "swipl",
        run_args,
        env,
        source_dir,
        job.stdin.clone(),
        PhaseBudget {
            timeout: job.limits.run_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );

    BuildPlan { compile, run }
}

pub(in crate::planner) fn plan_python(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
) -> BuildPlan {
    let entrypoint = entrypoint.to_string_lossy().into_owned();
    let compile = compile_command_plan(
        "python3",
        vec![
            "-c".to_owned(),
            "import ast, pathlib, sys; path=sys.argv[1]; ast.parse(pathlib.Path(path).read_text(encoding='utf-8'), filename=path)".to_owned(),
            entrypoint.clone(),
        ],
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );
    let mut run_args = vec!["-B".to_owned(), entrypoint];
    run_args.extend(job.args.clone());
    let run = run_command_plan(
        "python3",
        run_args,
        env,
        source_dir,
        job.stdin.clone(),
        PhaseBudget {
            timeout: job.limits.run_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );

    BuildPlan { compile, run }
}

pub(in crate::planner) fn plan_r(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
) -> BuildPlan {
    let entrypoint = entrypoint.to_string_lossy().into_owned();
    let compile = compile_command_plan(
        "Rscript",
        vec![
            "--vanilla".to_owned(),
            "-e".to_owned(),
            "args <- commandArgs(trailingOnly = TRUE); parse(file = args[[1]])".to_owned(),
            entrypoint.clone(),
        ],
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );
    let mut run_args = vec!["--vanilla".to_owned(), entrypoint];
    run_args.extend(job.args.clone());
    let run = run_command_plan(
        "Rscript",
        run_args,
        env,
        source_dir,
        job.stdin.clone(),
        PhaseBudget {
            timeout: job.limits.run_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );

    BuildPlan { compile, run }
}

pub(in crate::planner) fn plan_racket(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
) -> BuildPlan {
    let entrypoint = entrypoint.to_string_lossy().into_owned();
    let compile = compile_command_plan(
        "raco",
        vec!["make".to_owned(), entrypoint.clone()],
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );
    let mut run_args = vec!["-t".to_owned(), entrypoint];
    run_args.extend(job.args.clone());
    let run = run_command_plan(
        "racket",
        run_args,
        env,
        source_dir,
        job.stdin.clone(),
        PhaseBudget {
            timeout: job.limits.run_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );

    BuildPlan { compile, run }
}

pub(in crate::planner) fn plan_ruby(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
) -> BuildPlan {
    let entrypoint = entrypoint.to_string_lossy().into_owned();
    let compile = compile_command_plan(
        "ruby",
        vec!["-c".to_owned(), entrypoint.clone()],
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );
    let mut run_args = vec!["--disable=gems".to_owned(), entrypoint];
    run_args.extend(job.args.clone());
    let run = run_command_plan(
        "ruby",
        run_args,
        env,
        source_dir,
        job.stdin.clone(),
        PhaseBudget {
            timeout: job.limits.run_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );

    BuildPlan { compile, run }
}

pub(in crate::planner) fn plan_sql(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
) -> BuildPlan {
    let entrypoint = entrypoint.to_string_lossy().into_owned();
    let compile = compile_command_plan(
        "bash",
        vec![
            "--noprofile".to_owned(),
            "--norc".to_owned(),
            "-c".to_owned(),
            CHECK_READABLE_SCRIPT.to_owned(),
            "_".to_owned(),
            entrypoint.clone(),
        ],
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );
    let run = run_command_plan(
        "bash",
        vec![
            "--noprofile".to_owned(),
            "--norc".to_owned(),
            "-c".to_owned(),
            SQLITE_RUN_SCRIPT.to_owned(),
            "_".to_owned(),
            entrypoint,
        ],
        env,
        source_dir,
        job.stdin.clone(),
        PhaseBudget {
            timeout: job.limits.run_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );

    BuildPlan { compile, run }
}

pub(in crate::planner) fn plan_typescript(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
) -> BuildPlan {
    let output_dir = source_dir.join(RUNNER_BIN_DIR);
    let output_path = output_dir.join(
        entrypoint
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or("main")
            .to_owned()
            + ".js",
    );
    let entrypoint = entrypoint.to_string_lossy().into_owned();
    let compile = compile_command_plan(
        "tsc",
        vec![
            "--target".to_owned(),
            "ES2022".to_owned(),
            "--module".to_owned(),
            "commonjs".to_owned(),
            "--outDir".to_owned(),
            output_dir.to_string_lossy().into_owned(),
            entrypoint.clone(),
        ],
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );
    let mut run_args = vec![output_path.to_string_lossy().into_owned()];
    run_args.extend(job.args.clone());
    let run = run_command_plan(
        "node",
        run_args,
        env,
        source_dir,
        job.stdin.clone(),
        PhaseBudget {
            timeout: job.limits.run_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );

    BuildPlan { compile, run }
}

pub(in crate::planner) fn plan_wdl(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
) -> BuildPlan {
    let entrypoint = entrypoint.to_string_lossy().into_owned();
    let compile = compile_command_plan(
        "miniwdl",
        vec![
            "check".to_owned(),
            "--no-outside-imports".to_owned(),
            entrypoint.clone(),
        ],
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );
    let run = run_command_plan(
        "bash",
        vec![
            "--noprofile".to_owned(),
            "--norc".to_owned(),
            "-c".to_owned(),
            WDL_RUN_SCRIPT.to_owned(),
            "_".to_owned(),
            entrypoint,
        ],
        env,
        source_dir,
        job.stdin.clone(),
        PhaseBudget {
            timeout: job.limits.run_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
        },
        job,
    );

    BuildPlan { compile, run }
}
