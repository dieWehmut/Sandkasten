use laeufer_core::{BuildPlan, Job};
use std::path::PathBuf;

use crate::constants::RUNNER_BIN_DIR;
use crate::environment::go_compile_env;
use crate::planner::common::{compile_command_plan, run_command_plan, PhaseBudget};

pub(in crate::planner) fn plan_go(
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
