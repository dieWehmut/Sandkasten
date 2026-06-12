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
        "cangjie" => Ok(languages::plan_cangjie(
            job,
            source_dir,
            env,
            entrypoint,
            compile_memory_limit_bytes,
        )),
        "clojure" => Ok(languages::plan_clojure(job, source_dir, env, entrypoint)),
        "css" => Ok(languages::plan_css(job, source_dir, env, entrypoint)),
        "cpp" => Ok(languages::plan_cpp(
            job,
            source_dir,
            env,
            entrypoint,
            compile_memory_limit_bytes,
        )),
        "fortran" => Ok(languages::plan_fortran(
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
        "elixir" => Ok(languages::plan_elixir(job, source_dir, env, entrypoint)),
        "erlang" => Ok(languages::plan_erlang(
            job,
            source_dir,
            env,
            entrypoint,
            compile_memory_limit_bytes,
        )),
        "coq" => Ok(languages::plan_coq(
            job,
            source_dir,
            env,
            entrypoint,
            compile_memory_limit_bytes,
        )),
        "crystal" => Ok(languages::plan_crystal(
            job,
            source_dir,
            env,
            entrypoint,
            compile_memory_limit_bytes,
        )),
        "dart" => Ok(languages::plan_dart(
            job,
            source_dir,
            env,
            entrypoint,
            compile_memory_limit_bytes,
        )),
        "fsharp" => Ok(languages::plan_fsharp(
            job,
            source_dir,
            env,
            entrypoint,
            compile_memory_limit_bytes,
        )),
        "gdscript" => Ok(languages::plan_gdscript(job, source_dir, env, entrypoint)),
        "gleam" => Ok(languages::plan_gleam(
            job,
            source_dir,
            env,
            entrypoint,
            compile_memory_limit_bytes,
        )),
        "haskell" => Ok(languages::plan_haskell(
            job,
            source_dir,
            env,
            entrypoint,
            compile_memory_limit_bytes,
        )),
        "html" => Ok(languages::plan_html(job, source_dir, env, entrypoint)),
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
        "mojo" => Ok(languages::plan_mojo(
            job,
            source_dir,
            env,
            entrypoint,
            compile_memory_limit_bytes,
        )),
        "nextjs" => Ok(languages::plan_nextjs(job, source_dir, env, entrypoint)),
        "nextflow" => Ok(languages::plan_nextflow(job, source_dir, env, entrypoint)),
        "nim" => Ok(languages::plan_nim(
            job,
            source_dir,
            env,
            entrypoint,
            compile_memory_limit_bytes,
        )),
        "octave" => Ok(languages::plan_octave(job, source_dir, env, entrypoint)),
        "ocaml" => Ok(languages::plan_ocaml(
            job,
            source_dir,
            env,
            entrypoint,
            compile_memory_limit_bytes,
        )),
        "pascal" => Ok(languages::plan_pascal(
            job,
            source_dir,
            env,
            entrypoint,
            compile_memory_limit_bytes,
        )),
        "assembly" => Ok(languages::plan_assembly(
            job,
            source_dir,
            env,
            entrypoint,
            compile_memory_limit_bytes,
        )),
        "perl" => Ok(languages::plan_perl(job, source_dir, env, entrypoint)),
        "php" => Ok(languages::plan_php(job, source_dir, env, entrypoint)),
        "prolog" => Ok(languages::plan_prolog(job, source_dir, env, entrypoint)),
        "python" => Ok(languages::plan_python(job, source_dir, env, entrypoint)),
        "qml" => Ok(languages::plan_qml(job, source_dir, env, entrypoint)),
        "r" => Ok(languages::plan_r(job, source_dir, env, entrypoint)),
        "racket" => Ok(languages::plan_racket(job, source_dir, env, entrypoint)),
        "ruby" => Ok(languages::plan_ruby(job, source_dir, env, entrypoint)),
        "scala" => Ok(languages::plan_scala(
            job,
            source_dir,
            env,
            entrypoint,
            compile_memory_limit_bytes,
        )),
        "scss" => Ok(languages::plan_scss(job, source_dir, env, entrypoint)),
        "sql" => Ok(languages::plan_sql(job, source_dir, env, entrypoint)),
        "swift" => Ok(languages::plan_swift(
            job,
            source_dir,
            env,
            entrypoint,
            compile_memory_limit_bytes,
        )),
        "tailwindcss" => Ok(languages::plan_tailwindcss(
            job, source_dir, env, entrypoint,
        )),
        "typescript" => Ok(languages::plan_typescript(job, source_dir, env, entrypoint)),
        "tsx" => Ok(languages::plan_tsx(job, source_dir, env, entrypoint)),
        "vlang" => Ok(languages::plan_vlang(
            job,
            source_dir,
            env,
            entrypoint,
            compile_memory_limit_bytes,
        )),
        "vue3" => Ok(languages::plan_vue3(job, source_dir, env, entrypoint)),
        "wdl" => Ok(languages::plan_wdl(job, source_dir, env, entrypoint)),
        "zig" => Ok(languages::plan_zig(
            job,
            source_dir,
            env,
            entrypoint,
            compile_memory_limit_bytes,
        )),
        _ => Err(RunnerError::Validation(format!(
            "unsupported language {:?}",
            job.language
        ))),
    }
}
