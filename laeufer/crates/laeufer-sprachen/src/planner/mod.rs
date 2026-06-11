mod common;
mod languages;

use laeufer_core::{BuildPlan, Job, RunnerError};
use std::path::PathBuf;

use crate::archive::checked_entrypoint;
use crate::environment::runner_env;
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
        "go" => Ok(languages::plan_go(
            job,
            source_dir,
            env,
            entrypoint,
            compile_memory_limit_bytes,
        )),
        "bash" => Ok(languages::plan_bash(job, source_dir, env, entrypoint)),
        "c" => Ok(languages::plan_c(
            job,
            source_dir,
            env,
            entrypoint,
            compile_memory_limit_bytes,
        )),
        "cpp" => Ok(languages::plan_cpp(
            job,
            source_dir,
            env,
            entrypoint,
            compile_memory_limit_bytes,
        )),
        "rust" => Ok(languages::plan_rust(
            job,
            source_dir,
            env,
            entrypoint,
            compile_memory_limit_bytes,
        )),
        "java" => Ok(languages::plan_java(
            job,
            source_dir,
            env,
            entrypoint,
            compile_memory_limit_bytes,
        )),
        "kotlin" => Ok(languages::plan_kotlin(
            job,
            source_dir,
            env,
            entrypoint,
            compile_memory_limit_bytes,
        )),
        "csharp" => Ok(languages::plan_csharp(
            job,
            source_dir,
            env,
            entrypoint,
            compile_memory_limit_bytes,
        )),
        "javascript" => Ok(languages::plan_javascript(job, source_dir, env, entrypoint)),
        "julia" => Ok(languages::plan_julia(job, source_dir, env, entrypoint)),
        "lean4" => Ok(languages::plan_lean4(
            job,
            source_dir,
            env,
            entrypoint,
            compile_memory_limit_bytes,
        )),
        "lua" => Ok(languages::plan_lua(job, source_dir, env, entrypoint)),
        "python" => Ok(languages::plan_python(job, source_dir, env, entrypoint)),
        "r" => Ok(languages::plan_r(job, source_dir, env, entrypoint)),
        "ruby" => Ok(languages::plan_ruby(job, source_dir, env, entrypoint)),
        "typescript" => Ok(languages::plan_typescript(job, source_dir, env, entrypoint)),
        _ => Err(RunnerError::Validation(format!(
            "unsupported language {:?}",
            job.language
        ))),
    }
}
