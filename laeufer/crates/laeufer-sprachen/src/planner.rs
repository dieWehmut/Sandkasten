use laeufer_core::{BuildPlan, CommandPlan, Job, RunnerError, SeccompProfile};
use std::path::PathBuf;

use crate::archive::checked_entrypoint;
use crate::constants::{RUNNER_BIN_DIR, RUNNER_TMP_DIR};
use crate::environment::{go_compile_env, runner_env};
use crate::language::normalize_language;

pub(crate) fn plan(
    job: &Job,
    source_dir: PathBuf,
    compile_memory_limit_bytes: u64,
) -> Result<BuildPlan, RunnerError> {
    let language = normalize_language(&job.language).ok_or_else(|| {
        RunnerError::Validation(format!("unsupported language {:?}", job.language))
    })?;
    let entrypoint = checked_entrypoint(&job.entrypoint, &language)?;
    let env = runner_env(&source_dir);

    match language.as_str() {
        "go" => Ok(plan_go(
            job,
            source_dir,
            env,
            entrypoint,
            compile_memory_limit_bytes,
        )),
        "c" => Ok(plan_native(
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
        )),
        "cpp" => Ok(plan_native(
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
        )),
        "rust" => Ok(plan_rust(
            job,
            source_dir,
            env,
            entrypoint,
            compile_memory_limit_bytes,
        )),
        "java" => Ok(plan_java(
            job,
            source_dir,
            env,
            entrypoint,
            compile_memory_limit_bytes,
        )),
        "kotlin" => Ok(plan_kotlin(
            job,
            source_dir,
            env,
            entrypoint,
            compile_memory_limit_bytes,
        )),
        "csharp" => Ok(plan_csharp(
            job,
            source_dir,
            env,
            entrypoint,
            compile_memory_limit_bytes,
        )),
        "javascript" => Ok(plan_javascript(job, source_dir, env, entrypoint)),
        "julia" => Ok(plan_julia(job, source_dir, env, entrypoint)),
        "lean4" => Ok(plan_lean4(
            job,
            source_dir,
            env,
            entrypoint,
            compile_memory_limit_bytes,
        )),
        "lua" => Ok(plan_lua(job, source_dir, env, entrypoint)),
        "python" => Ok(plan_python(job, source_dir, env, entrypoint)),
        "r" => Ok(plan_r(job, source_dir, env, entrypoint)),
        "typescript" => Ok(plan_typescript(job, source_dir, env, entrypoint)),
        _ => Err(RunnerError::Validation(format!(
            "unsupported language {:?}",
            job.language
        ))),
    }
}

fn plan_go(
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

fn plan_rust(
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

fn plan_java(
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

fn plan_csharp(
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

fn plan_kotlin(
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

fn plan_javascript(
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

fn plan_julia(
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
            "Meta.parse(read(ARGS[1], String))".to_owned(),
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

fn plan_lean4(
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

fn plan_lua(
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

fn plan_python(
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

fn plan_r(
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

fn plan_typescript(
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

struct PhaseBudget {
    timeout: std::time::Duration,
    memory_limit_bytes: u64,
}

struct CommandBudget {
    timeout: std::time::Duration,
    memory_limit_bytes: u64,
    seccomp_profile: SeccompProfile,
}

fn compile_command_plan(
    program: impl Into<String>,
    args: Vec<String>,
    env: Vec<(String, String)>,
    cwd: PathBuf,
    stdin: bytes::Bytes,
    phase_budget: PhaseBudget,
    job: &Job,
) -> CommandPlan {
    command_plan(
        program,
        args,
        env,
        cwd,
        stdin,
        CommandBudget {
            timeout: phase_budget.timeout,
            memory_limit_bytes: phase_budget.memory_limit_bytes,
            seccomp_profile: SeccompProfile::Compile,
        },
        job,
    )
}

fn run_command_plan(
    program: impl Into<String>,
    args: Vec<String>,
    env: Vec<(String, String)>,
    cwd: PathBuf,
    stdin: bytes::Bytes,
    phase_budget: PhaseBudget,
    job: &Job,
) -> CommandPlan {
    command_plan(
        program,
        args,
        env,
        cwd,
        stdin,
        CommandBudget {
            timeout: phase_budget.timeout,
            memory_limit_bytes: phase_budget.memory_limit_bytes,
            seccomp_profile: SeccompProfile::Run,
        },
        job,
    )
}

fn command_plan(
    program: impl Into<String>,
    args: Vec<String>,
    env: Vec<(String, String)>,
    cwd: PathBuf,
    stdin: bytes::Bytes,
    phase_budget: CommandBudget,
    job: &Job,
) -> CommandPlan {
    CommandPlan {
        program: program.into(),
        args,
        env,
        cwd,
        stdin,
        timeout: phase_budget.timeout,
        memory_limit_bytes: phase_budget.memory_limit_bytes,
        cpu_millis: job.limits.cpu_millis,
        max_output_bytes: job.limits.max_output_bytes,
        seccomp_profile: phase_budget.seccomp_profile,
    }
}
