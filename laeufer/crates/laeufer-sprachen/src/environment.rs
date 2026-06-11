use std::path::Path;

use crate::constants::{DEFAULT_RUNTIME_PATH, RUNNER_TMP_DIR};
use crate::dirs::go_compile_cache_dir;

pub(crate) fn runner_env(job_dir: &Path) -> Vec<(String, String)> {
    let tmp_dir_path = job_dir.join(RUNNER_TMP_DIR);
    let tmp_dir = tmp_dir_path.to_string_lossy().into_owned();
    let julia_depot = tmp_dir_path
        .join("julia-depot")
        .to_string_lossy()
        .into_owned();
    let racket_user_home = tmp_dir_path
        .join("racket-addons")
        .to_string_lossy()
        .into_owned();
    let racket_compiled_roots = job_dir
        .join(crate::constants::RUNNER_CACHE_DIR)
        .join("racket-compiled")
        .to_string_lossy()
        .into_owned();
    let zig_local_cache = job_dir
        .join(crate::constants::RUNNER_CACHE_DIR)
        .join("zig-cache")
        .to_string_lossy()
        .into_owned();
    let zig_global_cache = job_dir
        .join(crate::constants::RUNNER_CACHE_DIR)
        .join("zig-global-cache")
        .to_string_lossy()
        .into_owned();
    vec![
        ("PATH".to_owned(), runtime_path()),
        ("HOME".to_owned(), tmp_dir.clone()),
        ("TMPDIR".to_owned(), tmp_dir.clone()),
        ("LANG".to_owned(), "C.UTF-8".to_owned()),
        ("LC_ALL".to_owned(), "C.UTF-8".to_owned()),
        ("GOTMPDIR".to_owned(), tmp_dir),
        ("GONOSUMDB".to_owned(), "*".to_owned()),
        ("GONOPROXY".to_owned(), "*".to_owned()),
        ("CGO_ENABLED".to_owned(), "0".to_owned()),
        ("GOTOOLCHAIN".to_owned(), "local".to_owned()),
        ("GOFLAGS".to_owned(), "-buildvcs=false".to_owned()),
        ("JULIA_DEPOT_PATH".to_owned(), julia_depot),
        ("JULIA_NUM_THREADS".to_owned(), "1".to_owned()),
        ("JULIA_PKG_PRECOMPILE_AUTO".to_owned(), "0".to_owned()),
        ("PYTHONDONTWRITEBYTECODE".to_owned(), "1".to_owned()),
        ("PLTUSERHOME".to_owned(), racket_user_home),
        ("PLTCOMPILEDROOTS".to_owned(), racket_compiled_roots),
        ("RUBYOPT".to_owned(), "--disable=gems".to_owned()),
        ("ZIG_LOCAL_CACHE_DIR".to_owned(), zig_local_cache),
        ("ZIG_GLOBAL_CACHE_DIR".to_owned(), zig_global_cache),
    ]
}

pub(crate) fn go_compile_env(job_dir: &Path) -> Vec<(String, String)> {
    let mut env = runner_env(job_dir);
    env.push((
        "GOCACHE".to_owned(),
        go_compile_cache_dir(job_dir).to_string_lossy().into_owned(),
    ));
    env
}

fn runtime_path() -> String {
    std::env::var("LAEUFER_RUNTIME_PATH").unwrap_or_else(|_| DEFAULT_RUNTIME_PATH.to_owned())
}
