use laeufer_core::{BuildPlan, Job};
use std::path::PathBuf;

use crate::constants::{RUNNER_BIN_DIR, RUNNER_CACHE_DIR, RUNNER_TMP_DIR};
use crate::planner::common::{compile_command_plan, run_command_plan, PhaseBudget};

const FSHARP_BUILD_SCRIPT: &str = r#"set -eu
entrypoint="$1"
project=".laeufer-cache/fsharp-project"
rm -rf "$project"
mkdir -p "$project"
cat > "$project/fsharp-project.fsproj" <<'EOF'
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <GenerateDocumentationFile>false</GenerateDocumentationFile>
    <NuGetAudit>false</NuGetAudit>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="Program.fs" />
  </ItemGroup>
</Project>
EOF
cp "$entrypoint" "$project/Program.fs"
dotnet restore "$project" --ignore-failed-sources --disable-parallel -p:NuGetAudit=false
dotnet build "$project" --no-restore -c Release -p:UseSharedCompilation=false -p:RunAnalyzers=false -p:NuGetAudit=false -o .laeufer-bin
"#;

pub(in crate::planner) fn plan_c(
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

pub(in crate::planner) fn plan_cpp(
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

pub(in crate::planner) fn plan_cangjie(
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

pub(in crate::planner) fn plan_nim(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
    compile_memory_limit_bytes: u64,
) -> BuildPlan {
    let binary_path = source_dir.join(RUNNER_BIN_DIR).join("main");
    let nim_cache = source_dir.join(RUNNER_CACHE_DIR).join("nim");
    let compile = compile_command_plan(
        "nim",
        vec![
            "c".to_owned(),
            "--hints:off".to_owned(),
            "--warnings:off".to_owned(),
            "--verbosity:0".to_owned(),
            "--parallelBuild:1".to_owned(),
            format!("--nimcache:{}", nim_cache.to_string_lossy()),
            "-d:release".to_owned(),
            format!("--out:{}", binary_path.to_string_lossy()),
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

pub(in crate::planner) fn plan_crystal(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
    compile_memory_limit_bytes: u64,
) -> BuildPlan {
    let binary_path = source_dir.join(RUNNER_BIN_DIR).join("main");
    let compile = compile_command_plan(
        "crystal",
        vec![
            "build".to_owned(),
            "--release".to_owned(),
            "--no-debug".to_owned(),
            entrypoint.to_string_lossy().into_owned(),
            "-o".to_owned(),
            binary_path.to_string_lossy().into_owned(),
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

pub(in crate::planner) fn plan_erlang(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
    compile_memory_limit_bytes: u64,
) -> BuildPlan {
    let output_dir = source_dir.join(RUNNER_BIN_DIR);
    let compile = compile_command_plan(
        "erlc",
        vec![
            "+debug_info".to_owned(),
            "-o".to_owned(),
            output_dir.to_string_lossy().into_owned(),
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
        "-noshell".to_owned(),
        "-pa".to_owned(),
        output_dir.to_string_lossy().into_owned(),
        "-s".to_owned(),
        "main".to_owned(),
        "main".to_owned(),
        "-s".to_owned(),
        "init".to_owned(),
        "stop".to_owned(),
    ];
    run_args.extend(job.args.clone());
    let run = run_command_plan(
        "erl",
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

pub(in crate::planner) fn plan_dart(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
    compile_memory_limit_bytes: u64,
) -> BuildPlan {
    let binary_path = source_dir.join(RUNNER_BIN_DIR).join("main");
    let compile = compile_command_plan(
        "dart",
        vec![
            "--disable-analytics".to_owned(),
            "compile".to_owned(),
            "exe".to_owned(),
            entrypoint.to_string_lossy().into_owned(),
            "-o".to_owned(),
            binary_path.to_string_lossy().into_owned(),
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

pub(in crate::planner) fn plan_mojo(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
    compile_memory_limit_bytes: u64,
) -> BuildPlan {
    let binary_path = source_dir.join(RUNNER_BIN_DIR).join("main");
    let compile = compile_command_plan(
        "mojo",
        vec![
            "build".to_owned(),
            entrypoint.to_string_lossy().into_owned(),
            "-o".to_owned(),
            binary_path.to_string_lossy().into_owned(),
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

pub(in crate::planner) fn plan_fsharp(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
    compile_memory_limit_bytes: u64,
) -> BuildPlan {
    let entrypoint = entrypoint.to_string_lossy().into_owned();
    let compile = compile_command_plan(
        "bash",
        vec![
            "--noprofile".to_owned(),
            "--norc".to_owned(),
            "-c".to_owned(),
            FSHARP_BUILD_SCRIPT.to_owned(),
            "_".to_owned(),
            entrypoint,
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
    let mut run_args = vec![source_dir
        .join(RUNNER_BIN_DIR)
        .join("fsharp-project.dll")
        .to_string_lossy()
        .into_owned()];
    run_args.extend(job.args.clone());
    let run = run_command_plan(
        "dotnet",
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

pub(in crate::planner) fn plan_fortran(
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
            program: "gfortran",
            args: vec!["-O2", "-pipe"],
            output_name: "main",
        },
        entrypoint,
        compile_memory_limit_bytes,
    )
}

pub(in crate::planner) fn plan_haskell(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
    compile_memory_limit_bytes: u64,
) -> BuildPlan {
    let binary_path = source_dir.join(RUNNER_BIN_DIR).join("main");
    let output_dir = source_dir.join(RUNNER_CACHE_DIR).join("haskell");
    let tmp_dir = source_dir.join(RUNNER_TMP_DIR);
    let compile = compile_command_plan(
        "ghc",
        vec![
            "-O2".to_owned(),
            "-threaded".to_owned(),
            "-outputdir".to_owned(),
            output_dir.to_string_lossy().into_owned(),
            "-tmpdir".to_owned(),
            tmp_dir.to_string_lossy().into_owned(),
            "-i.".to_owned(),
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

pub(in crate::planner) fn plan_pascal(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
    compile_memory_limit_bytes: u64,
) -> BuildPlan {
    let binary_path = source_dir.join(RUNNER_BIN_DIR).join("main");
    let compile = compile_command_plan(
        "fpc",
        vec![
            "-O2".to_owned(),
            format!("-FE{RUNNER_BIN_DIR}"),
            "-omain".to_owned(),
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

pub(in crate::planner) fn plan_assembly(
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
            args: vec!["-x", "assembler", "-no-pie"],
            output_name: "main",
        },
        entrypoint,
        compile_memory_limit_bytes,
    )
}

pub(in crate::planner) fn plan_ocaml(
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
            program: "ocamlopt",
            args: Vec::new(),
            output_name: "main",
        },
        entrypoint,
        compile_memory_limit_bytes,
    )
}

pub(in crate::planner) fn plan_vlang(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
    compile_memory_limit_bytes: u64,
) -> BuildPlan {
    let binary_path = source_dir.join(RUNNER_BIN_DIR).join("main");
    let compile = compile_command_plan(
        "v",
        vec![
            "-prod".to_owned(),
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

pub(in crate::planner) fn plan_rust(
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

pub(in crate::planner) fn plan_java(
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

pub(in crate::planner) fn plan_csharp(
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

pub(in crate::planner) fn plan_coq(
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

pub(in crate::planner) fn plan_kotlin(
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

pub(in crate::planner) fn plan_lean4(
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

pub(in crate::planner) fn plan_scala(
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

pub(in crate::planner) fn plan_swift(
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

pub(in crate::planner) fn plan_zig(
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
