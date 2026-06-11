use laeufer_core::{BuildPlan, Job};
use std::path::PathBuf;

use crate::constants::{RUNNER_BIN_DIR, RUNNER_CACHE_DIR, RUNNER_TMP_DIR};
use crate::environment::go_compile_env;
use crate::planner::common::{compile_command_plan, run_command_plan, PhaseBudget};

const JULIA_SYNTAX_CHECK: &str = "function has_parse_error(x); x isa Expr && (x.head in (:error, :incomplete) || any(has_parse_error, x.args)); end; ex = Meta.parseall(read(ARGS[1], String)); has_parse_error(ex) && (println(stderr, \"Julia syntax error\"); exit(1))";
const CHECK_READABLE_SCRIPT: &str = "test -r \"$1\"";
const PROLOG_SYNTAX_CHECK: &str = "current_prolog_flag(argv, [Path|_]), setup_call_cleanup(open(Path, read, S, [encoding(utf8)]), (repeat, read_term(S, Term, [syntax_errors(error)]), (Term == end_of_file -> ! ; fail)), close(S)), halt.";
const SQLITE_RUN_SCRIPT: &str = "exec sqlite3 -batch -bail -safe :memory: < \"$1\"";

pub(super) fn plan_go(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
    compile_memory_limit_bytes: u64,
) -> BuildPlan {
    let binary_path = source_dir.join(RUNNER_BIN_DIR).join("main");
    let compile_env = go_compile_env(&source_dir);
    let compile = compile_command_plan(
        "go",
        vec![
            "build".to_owned(),
            "-mod=vendor".to_owned(),
            "-trimpath".to_owned(),
            "-o".to_owned(),
            binary_path.to_string_lossy().into_owned(),
            entrypoint.to_string_lossy().into_owned(),
        ],
        compile_env,
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: compile_memory_limit_bytes,
        },
        job,
    );
    let run = run_command_plan(
        binary_path.to_string_lossy().into_owned(),
        job.args.clone(),
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

pub(super) fn plan_bash(
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

pub(super) fn plan_c(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
    compile_memory_limit_bytes: u64,
) -> BuildPlan {
    plan_native(
        job,
        source_dir,
        env,
        NativeCompiler {
            program: "gcc",
            args: vec!["-O2", "-pipe"],
            output_name: "main",
        },
        entrypoint,
        compile_memory_limit_bytes,
    )
}

pub(super) fn plan_cpp(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
    compile_memory_limit_bytes: u64,
) -> BuildPlan {
    plan_native(
        job,
        source_dir,
        env,
        NativeCompiler {
            program: "g++",
            args: vec!["-std=c++20", "-O2", "-pipe"],
            output_name: "main",
        },
        entrypoint,
        compile_memory_limit_bytes,
    )
}

pub(super) fn plan_cangjie(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
    compile_memory_limit_bytes: u64,
) -> BuildPlan {
    let binary_path = source_dir.join(RUNNER_BIN_DIR).join("main");
    let compile = compile_command_plan(
        "cjc",
        vec![
            "-O".to_owned(),
            "--jobs".to_owned(),
            "1".to_owned(),
            "--set-runtime-rpath".to_owned(),
            "-o".to_owned(),
            binary_path.to_string_lossy().into_owned(),
            entrypoint.to_string_lossy().into_owned(),
        ],
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: compile_memory_limit_bytes,
        },
        job,
    );
    let run = run_command_plan(
        binary_path.to_string_lossy().into_owned(),
        job.args.clone(),
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

struct NativeCompiler {
    program: &'static str,
    args: Vec<&'static str>,
    output_name: &'static str,
}

fn plan_native(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    compiler: NativeCompiler,
    entrypoint: PathBuf,
    compile_memory_limit_bytes: u64,
) -> BuildPlan {
    let binary_path = source_dir.join(RUNNER_BIN_DIR).join(compiler.output_name);
    let mut args: Vec<String> = compiler.args.into_iter().map(str::to_owned).collect();
    args.extend([
        "-o".to_owned(),
        binary_path.to_string_lossy().into_owned(),
        entrypoint.to_string_lossy().into_owned(),
    ]);
    let compile = compile_command_plan(
        compiler.program,
        args,
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: compile_memory_limit_bytes,
        },
        job,
    );
    let run = run_command_plan(
        binary_path.to_string_lossy().into_owned(),
        job.args.clone(),
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

pub(super) fn plan_rust(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
    compile_memory_limit_bytes: u64,
) -> BuildPlan {
    let binary_path = source_dir.join(RUNNER_BIN_DIR).join("main");
    let compile = compile_command_plan(
        "rustc",
        vec![
            "--edition=2021".to_owned(),
            "-O".to_owned(),
            "-o".to_owned(),
            binary_path.to_string_lossy().into_owned(),
            entrypoint.to_string_lossy().into_owned(),
        ],
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: compile_memory_limit_bytes,
        },
        job,
    );
    let run = run_command_plan(
        binary_path.to_string_lossy().into_owned(),
        job.args.clone(),
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

pub(super) fn plan_java(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
    compile_memory_limit_bytes: u64,
) -> BuildPlan {
    let class_dir = source_dir.join(RUNNER_BIN_DIR);
    let main_class = entrypoint
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("Main")
        .to_owned();
    let compile = compile_command_plan(
        "javac",
        vec![
            "-encoding".to_owned(),
            "UTF-8".to_owned(),
            "-d".to_owned(),
            class_dir.to_string_lossy().into_owned(),
            entrypoint.to_string_lossy().into_owned(),
        ],
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: compile_memory_limit_bytes,
        },
        job,
    );
    let mut run_args = vec![
        "-cp".to_owned(),
        class_dir.to_string_lossy().into_owned(),
        main_class,
    ];
    run_args.extend(job.args.clone());
    let run = run_command_plan(
        "java",
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

pub(super) fn plan_csharp(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
    compile_memory_limit_bytes: u64,
) -> BuildPlan {
    let binary_path = source_dir.join(RUNNER_BIN_DIR).join("main.exe");
    let compile = compile_command_plan(
        "mcs",
        vec![
            "-nologo".to_owned(),
            format!("-out:{}", binary_path.to_string_lossy()),
            entrypoint.to_string_lossy().into_owned(),
        ],
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: compile_memory_limit_bytes,
        },
        job,
    );
    let mut run_args = vec![binary_path.to_string_lossy().into_owned()];
    run_args.extend(job.args.clone());
    let run = run_command_plan(
        "mono",
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

pub(super) fn plan_coq(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
    compile_memory_limit_bytes: u64,
) -> BuildPlan {
    let vo_path = source_dir
        .join(
            entrypoint
                .file_stem()
                .and_then(|name| name.to_str())
                .unwrap_or("main"),
        )
        .with_extension("vo");
    let compile = compile_command_plan(
        "coqc",
        vec![
            "-q".to_owned(),
            "-R".to_owned(),
            ".".to_owned(),
            "Sandbox".to_owned(),
            entrypoint.to_string_lossy().into_owned(),
        ],
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: compile_memory_limit_bytes,
        },
        job,
    );
    let run = run_command_plan(
        "test",
        vec!["-f".to_owned(), vo_path.to_string_lossy().into_owned()],
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

pub(super) fn plan_kotlin(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
    compile_memory_limit_bytes: u64,
) -> BuildPlan {
    let jar_path = source_dir.join(RUNNER_BIN_DIR).join("main.jar");
    let tmp_arg = format!(
        "-J-Djava.io.tmpdir={}",
        source_dir.join(RUNNER_TMP_DIR).to_string_lossy()
    );
    let compile = compile_command_plan(
        "kotlinc",
        vec![
            "-J-XX:ActiveProcessorCount=1".to_owned(),
            tmp_arg,
            entrypoint.to_string_lossy().into_owned(),
            "-include-runtime".to_owned(),
            "-d".to_owned(),
            jar_path.to_string_lossy().into_owned(),
        ],
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: compile_memory_limit_bytes,
        },
        job,
    );
    let mut run_args = vec![
        "-XX:ActiveProcessorCount=1".to_owned(),
        format!(
            "-Djava.io.tmpdir={}",
            source_dir.join(RUNNER_TMP_DIR).to_string_lossy()
        ),
        "-jar".to_owned(),
        jar_path.to_string_lossy().into_owned(),
    ];
    run_args.extend(job.args.clone());
    let run = run_command_plan(
        "java",
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

pub(super) fn plan_javascript(
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

pub(super) fn plan_julia(
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

pub(super) fn plan_lean4(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
    compile_memory_limit_bytes: u64,
) -> BuildPlan {
    let olean_path = source_dir.join(RUNNER_BIN_DIR).join("main.olean");
    let entrypoint = entrypoint.to_string_lossy().into_owned();
    let compile = compile_command_plan(
        "lean",
        vec![
            "-o".to_owned(),
            olean_path.to_string_lossy().into_owned(),
            entrypoint.clone(),
        ],
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: compile_memory_limit_bytes,
        },
        job,
    );
    let mut run_args = vec!["--run".to_owned(), entrypoint];
    run_args.extend(job.args.clone());
    let run = run_command_plan(
        "lean",
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

pub(super) fn plan_lua(
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

pub(super) fn plan_php(
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

pub(super) fn plan_prolog(
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

pub(super) fn plan_python(
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

pub(super) fn plan_r(
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

pub(super) fn plan_racket(
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

pub(super) fn plan_ruby(
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

pub(super) fn plan_scala(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
    compile_memory_limit_bytes: u64,
) -> BuildPlan {
    let class_dir = source_dir.join(RUNNER_BIN_DIR);
    let main_class = entrypoint
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("Main")
        .to_owned();
    let tmp_arg = format!(
        "-J-Djava.io.tmpdir={}",
        source_dir.join(RUNNER_TMP_DIR).to_string_lossy()
    );
    let compile = compile_command_plan(
        "scalac",
        vec![
            "-J-XX:ActiveProcessorCount=1".to_owned(),
            tmp_arg,
            "-d".to_owned(),
            class_dir.to_string_lossy().into_owned(),
            entrypoint.to_string_lossy().into_owned(),
        ],
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: compile_memory_limit_bytes,
        },
        job,
    );
    let mut run_args = vec![
        "-J-XX:ActiveProcessorCount=1".to_owned(),
        "-Dscala.usejavacp=true".to_owned(),
        "-cp".to_owned(),
        class_dir.to_string_lossy().into_owned(),
        main_class,
    ];
    run_args.extend(job.args.clone());
    let run = run_command_plan(
        "scala",
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

pub(super) fn plan_sql(
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

pub(super) fn plan_swift(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
    compile_memory_limit_bytes: u64,
) -> BuildPlan {
    let binary_path = source_dir.join(RUNNER_BIN_DIR).join("main");
    let compile = compile_command_plan(
        "swiftc",
        vec![
            "-O".to_owned(),
            "-o".to_owned(),
            binary_path.to_string_lossy().into_owned(),
            entrypoint.to_string_lossy().into_owned(),
        ],
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: compile_memory_limit_bytes,
        },
        job,
    );
    let run = run_command_plan(
        binary_path.to_string_lossy().into_owned(),
        job.args.clone(),
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

pub(super) fn plan_typescript(
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

pub(super) fn plan_zig(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
    compile_memory_limit_bytes: u64,
) -> BuildPlan {
    let binary_path = source_dir.join(RUNNER_BIN_DIR).join("main");
    let local_cache = source_dir.join(RUNNER_CACHE_DIR).join("zig-cache");
    let global_cache = source_dir.join(RUNNER_CACHE_DIR).join("zig-global-cache");
    let compile = compile_command_plan(
        "zig",
        vec![
            "build-exe".to_owned(),
            "-O".to_owned(),
            "ReleaseSafe".to_owned(),
            "-lc".to_owned(),
            "--cache-dir".to_owned(),
            local_cache.to_string_lossy().into_owned(),
            "--global-cache-dir".to_owned(),
            global_cache.to_string_lossy().into_owned(),
            format!("-femit-bin={}", binary_path.to_string_lossy()),
            entrypoint.to_string_lossy().into_owned(),
        ],
        env.clone(),
        source_dir.clone(),
        Default::default(),
        PhaseBudget {
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: compile_memory_limit_bytes,
        },
        job,
    );
    let run = run_command_plan(
        binary_path.to_string_lossy().into_owned(),
        job.args.clone(),
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
