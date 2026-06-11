use std::fs;
use std::path::{Path, PathBuf};

use crate::constants::{
    GO_BUILD_CACHE_DIR, GO_BUILD_CACHE_ENV, RUNNER_BIN_DIR, RUNNER_CACHE_DIR, RUNNER_SHARED_DIR,
    RUNNER_TMP_DIR,
};

pub(crate) fn prepare_runner_dirs(job_dir: &Path) -> std::io::Result<()> {
    allow_unprivileged_write(job_dir)?;
    for dirname in [RUNNER_BIN_DIR, RUNNER_TMP_DIR] {
        let path = job_dir.join(dirname);
        fs::create_dir_all(&path)?;
        allow_unprivileged_write(&path)?;
    }
    Ok(())
}

pub(crate) fn prepare_go_compile_cache_dir(cache_dir: &Path) -> std::io::Result<()> {
    fs::create_dir_all(cache_dir)?;
    allow_unprivileged_write(cache_dir)
}

pub(crate) fn go_compile_cache_dir(job_dir: &Path) -> PathBuf {
    if let Some(path) = non_empty_env_path(GO_BUILD_CACHE_ENV) {
        return path;
    }
    if non_empty_env_path("LAEUFER_ROOTFS").is_some() {
        return job_dir.join(RUNNER_CACHE_DIR);
    }
    runner_work_dir(job_dir)
        .join(RUNNER_SHARED_DIR)
        .join(GO_BUILD_CACHE_DIR)
}

fn runner_work_dir(job_dir: &Path) -> PathBuf {
    job_dir
        .parent()
        .and_then(Path::parent)
        .unwrap_or(job_dir)
        .to_path_buf()
}

fn non_empty_env_path(name: &str) -> Option<PathBuf> {
    std::env::var_os(name)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

#[cfg(unix)]
fn allow_unprivileged_write(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    let mut permissions = fs::metadata(path)?.permissions();
    permissions.set_mode(0o777);
    fs::set_permissions(path, permissions)
}

#[cfg(not(unix))]
fn allow_unprivileged_write(_: &Path) -> std::io::Result<()> {
    Ok(())
}
