use flate2::read::GzDecoder;
use laeufer_core::{BuildPlan, CommandPlan, Job, LanguageRuntime, RunnerError};
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};
use tar::Archive;
use thiserror::Error;

const RUNNER_BIN_DIR: &str = ".laeufer-bin";
const RUNNER_CACHE_DIR: &str = ".laeufer-cache";
const RUNNER_TMP_DIR: &str = ".laeufer-tmp";
const DEFAULT_RUNTIME_PATH: &str = "/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin";
const DEFAULT_MAX_ARCHIVE_BYTES: u64 = 64 * 1024 * 1024;
const DEFAULT_MAX_ARCHIVE_FILES: usize = 20_000;
const DEFAULT_COMPILE_MEMORY_LIMIT_BYTES: u64 = 1024 * 1024 * 1024;

#[derive(Clone, Debug)]
pub struct SprachenRuntime {
    work_root: PathBuf,
    limits: ArchiveLimits,
    compile_memory_limit_bytes: u64,
}

impl SprachenRuntime {
    pub fn new(work_root: impl Into<PathBuf>) -> Self {
        Self {
            work_root: work_root.into(),
            limits: ArchiveLimits::default(),
            compile_memory_limit_bytes: DEFAULT_COMPILE_MEMORY_LIMIT_BYTES,
        }
    }

    pub fn with_options(work_root: impl Into<PathBuf>, options: SprachenRuntimeOptions) -> Self {
        Self {
            work_root: work_root.into(),
            limits: options.archive_limits,
            compile_memory_limit_bytes: options.compile_memory_limit_bytes,
        }
    }

    pub fn validate_archive(
        language: &str,
        archive_targz: &[u8],
    ) -> Result<ArchiveLayout, ArchiveError> {
        inspect_archive(
            archive_targz,
            ArchiveLimits::default(),
            archive_requirements(language)?,
        )
    }

    pub fn extract_archive(
        language: &str,
        archive_targz: &[u8],
        destination: &Path,
        limits: ArchiveLimits,
    ) -> Result<ArchiveLayout, ArchiveError> {
        let layout = inspect_archive(archive_targz, limits, archive_requirements(language)?)?;
        fs::create_dir_all(destination)?;

        let decoder = GzDecoder::new(Cursor::new(archive_targz));
        let mut archive = Archive::new(decoder);
        for entry in archive.entries()? {
            let mut entry = entry?;
            let normalized = checked_entry_path(&entry)?;
            if normalized.as_os_str().is_empty() {
                continue;
            }
            if !entry.unpack_in(destination)? {
                return Err(ArchiveError::UnsafePath(normalized));
            }
        }

        Ok(layout)
    }

    pub fn plan(
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
            "csharp" => Ok(plan_csharp(
                job,
                source_dir,
                env,
                entrypoint,
                compile_memory_limit_bytes,
            )),
            "javascript" => Ok(plan_javascript(job, source_dir, env, entrypoint)),
            "python" => Ok(plan_python(job, source_dir, env, entrypoint)),
            "typescript" => Ok(plan_typescript(job, source_dir, env, entrypoint)),
            _ => Err(RunnerError::Validation(format!(
                "unsupported language {:?}",
                job.language
            ))),
        }
    }
}

#[async_trait::async_trait]
impl LanguageRuntime for SprachenRuntime {
    async fn prepare(&self, job: &Job) -> Result<BuildPlan, RunnerError> {
        let language = normalize_language(&job.language).ok_or_else(|| {
            RunnerError::Validation(format!("unsupported language {:?}", job.language))
        })?;
        let job_dir = self.work_root.join(job.job_id.to_string()).join("src");
        Self::extract_archive(&language, &job.archive_targz, &job_dir, self.limits)
            .map_err(|error| RunnerError::Validation(error.to_string()))?;
        prepare_runner_dirs(&job_dir).map_err(|error| RunnerError::System(error.to_string()))?;

        Self::plan(job, job_dir, self.compile_memory_limit_bytes)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SprachenRuntimeOptions {
    pub archive_limits: ArchiveLimits,
    pub compile_memory_limit_bytes: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ArchiveLimits {
    pub max_archive_bytes: u64,
    pub max_files: usize,
}

impl Default for ArchiveLimits {
    fn default() -> Self {
        Self {
            max_archive_bytes: DEFAULT_MAX_ARCHIVE_BYTES,
            max_files: DEFAULT_MAX_ARCHIVE_FILES,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ArchiveLayout {
    pub file_count: usize,
    pub unpacked_bytes: u64,
}

#[derive(Debug, Error)]
pub enum ArchiveError {
    #[error("unsupported language {0:?}")]
    UnsupportedLanguage(String),
    #[error("archive must contain go.mod as a regular file at the project root")]
    MissingGoMod,
    #[error("archive must contain vendor/ at the project root")]
    MissingVendor,
    #[error("archive path {0:?} is unsafe")]
    UnsafePath(PathBuf),
    #[error("archive path {0:?} is reserved for runner output")]
    ReservedPath(PathBuf),
    #[error("archive entry {path:?} has unsupported tar type {entry_type}")]
    UnsupportedEntry { path: PathBuf, entry_type: u8 },
    #[error("archive has too many regular files; limit is {limit}")]
    TooManyFiles { limit: usize },
    #[error("archive unpacks to too many bytes; limit is {limit}")]
    TooLarge { limit: u64 },
    #[error("archive read failed: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ArchiveRequirements {
    require_go_mod: bool,
    require_vendor: bool,
}

fn archive_requirements(language: &str) -> Result<ArchiveRequirements, ArchiveError> {
    let language = normalize_language(language)
        .ok_or_else(|| ArchiveError::UnsupportedLanguage(language.to_owned()))?;
    Ok(ArchiveRequirements {
        require_go_mod: language == "go",
        require_vendor: language == "go",
    })
}

fn inspect_archive(
    archive_targz: &[u8],
    limits: ArchiveLimits,
    requirements: ArchiveRequirements,
) -> Result<ArchiveLayout, ArchiveError> {
    if archive_targz.len() as u64 > limits.max_archive_bytes {
        return Err(ArchiveError::TooLarge {
            limit: limits.max_archive_bytes,
        });
    }

    let decoder = GzDecoder::new(Cursor::new(archive_targz));
    let mut archive = Archive::new(decoder);
    let mut has_go_mod = false;
    let mut has_vendor = false;
    let mut file_count = 0usize;
    let mut unpacked_bytes = 0u64;

    for entry in archive.entries()? {
        let mut entry = entry?;
        let normalized = checked_entry_path(&entry)?;
        if normalized.as_os_str().is_empty() {
            continue;
        }

        let entry_type = entry.header().entry_type();
        if entry_type.is_file() {
            file_count += 1;
            if file_count > limits.max_files {
                return Err(ArchiveError::TooManyFiles {
                    limit: limits.max_files,
                });
            }
            unpacked_bytes = unpacked_bytes.saturating_add(entry.header().size()?);
            if unpacked_bytes > limits.max_archive_bytes {
                return Err(ArchiveError::TooLarge {
                    limit: limits.max_archive_bytes,
                });
            }
            if normalized == Path::new("go.mod") {
                has_go_mod = true;
            }
        }

        if (entry_type.is_dir() && normalized == Path::new("vendor"))
            || (normalized.starts_with(Path::new("vendor")) && normalized != Path::new("vendor"))
        {
            has_vendor = true;
        }

        let mut sink = [0u8; 8192];
        while entry.read(&mut sink)? != 0 {}
    }

    if requirements.require_go_mod && !has_go_mod {
        return Err(ArchiveError::MissingGoMod);
    }
    if requirements.require_vendor && !has_vendor {
        return Err(ArchiveError::MissingVendor);
    }

    Ok(ArchiveLayout {
        file_count,
        unpacked_bytes,
    })
}

fn checked_entry_path<R: Read>(entry: &tar::Entry<'_, R>) -> Result<PathBuf, ArchiveError> {
    let entry_type = entry.header().entry_type();
    let raw_path = entry.path()?.into_owned();
    let normalized = normalize_archive_path(&raw_path)?;

    if is_reserved_runner_path(&normalized) {
        return Err(ArchiveError::ReservedPath(normalized));
    }

    if entry_type.is_file() || entry_type.is_dir() {
        Ok(normalized)
    } else {
        Err(ArchiveError::UnsupportedEntry {
            path: normalized,
            entry_type: entry_type.as_byte(),
        })
    }
}

fn checked_entrypoint(entrypoint: &str, language: &str) -> Result<PathBuf, RunnerError> {
    let trimmed = entrypoint.trim();
    if trimmed.is_empty() {
        return Err(RunnerError::Validation("entrypoint is required".to_owned()));
    }
    if language == "go" && trimmed == "." {
        return Ok(PathBuf::from("."));
    }
    let normalized = normalize_archive_path(Path::new(trimmed))
        .map_err(|error| RunnerError::Validation(error.to_string()))?;
    if normalized.as_os_str().is_empty() || is_reserved_runner_path(&normalized) {
        return Err(RunnerError::Validation(format!(
            "entrypoint {:?} is reserved or empty",
            entrypoint
        )));
    }
    Ok(normalized)
}

fn normalize_archive_path(path: &Path) -> Result<PathBuf, ArchiveError> {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => normalized.push(part),
            Component::CurDir => {}
            Component::Prefix(_) | Component::RootDir | Component::ParentDir => {
                return Err(ArchiveError::UnsafePath(path.to_path_buf()));
            }
        }
    }
    Ok(normalized)
}

fn is_reserved_runner_path(path: &Path) -> bool {
    path.starts_with(Path::new(RUNNER_BIN_DIR))
        || path.starts_with(Path::new(RUNNER_CACHE_DIR))
        || path.starts_with(Path::new(RUNNER_TMP_DIR))
}

fn prepare_runner_dirs(job_dir: &Path) -> std::io::Result<()> {
    for dirname in [RUNNER_BIN_DIR, RUNNER_CACHE_DIR, RUNNER_TMP_DIR] {
        let path = job_dir.join(dirname);
        fs::create_dir_all(&path)?;
        allow_unprivileged_write(&path)?;
    }
    Ok(())
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

fn runner_env(job_dir: &Path) -> Vec<(String, String)> {
    let tmp_dir = job_dir.join(RUNNER_TMP_DIR).to_string_lossy().into_owned();
    let cache_dir = job_dir
        .join(RUNNER_CACHE_DIR)
        .to_string_lossy()
        .into_owned();
    vec![
        ("PATH".to_owned(), runtime_path()),
        ("HOME".to_owned(), tmp_dir.clone()),
        ("TMPDIR".to_owned(), tmp_dir.clone()),
        ("LANG".to_owned(), "C.UTF-8".to_owned()),
        ("LC_ALL".to_owned(), "C.UTF-8".to_owned()),
        ("GOCACHE".to_owned(), cache_dir),
        ("GOTMPDIR".to_owned(), tmp_dir),
        ("GONOSUMDB".to_owned(), "*".to_owned()),
        ("GONOPROXY".to_owned(), "*".to_owned()),
        ("PYTHONDONTWRITEBYTECODE".to_owned(), "1".to_owned()),
    ]
}

fn runtime_path() -> String {
    std::env::var("LAEUFER_RUNTIME_PATH").unwrap_or_else(|_| DEFAULT_RUNTIME_PATH.to_owned())
}

fn normalize_language(language: &str) -> Option<String> {
    let normalized = language.trim().to_ascii_lowercase();
    let canonical = match normalized.as_str() {
        "go" | "golang" => "go",
        "c" => "c",
        "cpp" | "c++" => "cpp",
        "csharp" | "cs" | "c#" => "csharp",
        "java" => "java",
        "javascript" | "js" | "node" => "javascript",
        "python" | "py" | "python3" => "python",
        "rust" | "rs" => "rust",
        "typescript" | "ts" => "typescript",
        _ => return None,
    };
    Some(canonical.to_owned())
}

fn plan_go(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
    compile_memory_limit_bytes: u64,
) -> BuildPlan {
    let binary_path = source_dir.join(RUNNER_BIN_DIR).join("main");
    let compile = command_plan(
        "go",
        vec![
            "build".to_owned(),
            "-mod=vendor".to_owned(),
            "-trimpath".to_owned(),
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
    let run = command_plan(
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
    let compile = command_plan(
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
    let run = command_plan(
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
    let compile = command_plan(
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
    let run = command_plan(
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
    let compile = command_plan(
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
    let run = command_plan(
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
    let compile = command_plan(
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
    let run = command_plan(
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

fn plan_javascript(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
) -> BuildPlan {
    let entrypoint = entrypoint.to_string_lossy().into_owned();
    let compile = command_plan(
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
    let run = command_plan(
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

fn plan_python(
    job: &Job,
    source_dir: PathBuf,
    env: Vec<(String, String)>,
    entrypoint: PathBuf,
) -> BuildPlan {
    let entrypoint = entrypoint.to_string_lossy().into_owned();
    let compile = command_plan(
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
    let run = command_plan(
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
    let compile = command_plan(
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
    let run = command_plan(
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

fn command_plan(
    program: impl Into<String>,
    args: Vec<String>,
    env: Vec<(String, String)>,
    cwd: PathBuf,
    stdin: bytes::Bytes,
    phase_budget: PhaseBudget,
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
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bytes::Bytes;
    use chrono::Utc;
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use laeufer_core::{JobLimits, JobStatus};
    use std::io::Write;
    use std::time::Duration;
    use tar::{Builder, EntryType, Header};
    use uuid::Uuid;

    #[test]
    fn go_archive_requires_vendor_tree() {
        let archive = archive_with(&[
            ("go.mod", b"module example.com/demo\n".as_slice()),
            ("main.go", b"package main\nfunc main(){}\n".as_slice()),
        ]);

        let err = SprachenRuntime::validate_archive("go", &archive).expect_err("invalid archive");

        assert!(matches!(err, ArchiveError::MissingVendor));
    }

    #[test]
    fn non_go_archive_accepts_single_source_file() {
        let archive = archive_with(&[("main.py", b"print('hello')\n".as_slice())]);

        let layout = SprachenRuntime::validate_archive("python", &archive).expect("valid archive");

        assert_eq!(layout.file_count, 1);
        assert!(layout.unpacked_bytes > 0);
    }

    #[test]
    fn archive_rejects_reserved_runtime_paths() {
        let archive = archive_with(&[(".laeufer-bin/main", b"owned\n".as_slice())]);

        let err =
            SprachenRuntime::validate_archive("python", &archive).expect_err("invalid archive");

        assert!(matches!(err, ArchiveError::ReservedPath(_)));
    }

    #[test]
    fn archive_rejects_path_traversal() {
        let archive = archive_with_raw_file("../escape", b"nope", EntryType::Regular);

        let err =
            SprachenRuntime::validate_archive("python", &archive).expect_err("invalid archive");

        assert!(matches!(err, ArchiveError::UnsafePath(_)));
    }

    #[test]
    fn python_plan_checks_syntax_without_bytecode_write() {
        let job = job("python", "main.py");
        let plan =
            SprachenRuntime::plan(&job, PathBuf::from("/tmp/job/src"), 128 * 1024 * 1024).unwrap();

        assert_eq!(plan.compile.program, "python3");
        assert_eq!(plan.compile.args[0], "-c");
        assert_eq!(plan.run.program, "python3");
        assert_eq!(plan.run.args[0], "-B");
        assert!(plan
            .run
            .env
            .iter()
            .any(|(key, value)| key == "PYTHONDONTWRITEBYTECODE" && value == "1"));
    }

    #[test]
    fn typescript_plan_type_checks_then_runs_with_node_transform() {
        let job = job("typescript", "main.ts");
        let plan =
            SprachenRuntime::plan(&job, PathBuf::from("/tmp/job/src"), 128 * 1024 * 1024).unwrap();

        assert_eq!(plan.compile.program, "tsc");
        assert!(plan.compile.args.iter().any(|arg| arg == "--outDir"));
        assert_eq!(plan.run.program, "node");
        assert!(plan
            .run
            .args
            .iter()
            .any(|arg| arg.ends_with(".laeufer-bin/main.js")));
    }

    #[test]
    fn java_plan_uses_entrypoint_stem_as_class_name() {
        let job = job("java", "Main.java");
        let plan =
            SprachenRuntime::plan(&job, PathBuf::from("/tmp/job/src"), 128 * 1024 * 1024).unwrap();

        assert_eq!(plan.compile.program, "javac");
        assert_eq!(plan.run.program, "java");
        assert!(plan.run.args.iter().any(|arg| arg == "Main"));
    }

    #[test]
    fn entrypoint_rejects_traversal() {
        let job = job("python", "../main.py");

        let err = SprachenRuntime::plan(&job, PathBuf::from("/tmp/job/src"), 128 * 1024 * 1024)
            .expect_err("invalid entrypoint");

        assert!(matches!(err, RunnerError::Validation(_)));
    }

    #[test]
    fn prepare_extracts_archive_and_creates_writable_runner_dirs() {
        let archive = archive_with(&[("main.py", b"print('hello')\n".as_slice())]);
        let dir = tempfile::tempdir().unwrap();
        let layout = SprachenRuntime::extract_archive(
            "python",
            &archive,
            &dir.path().join("src"),
            ArchiveLimits::default(),
        )
        .unwrap();

        assert_eq!(layout.file_count, 1);
        assert!(dir.path().join("src/main.py").is_file());
    }

    fn job(language: &str, entrypoint: &str) -> Job {
        Job {
            job_id: Uuid::new_v4(),
            attempt_id: Uuid::new_v4(),
            status: JobStatus::Queued,
            language: language.to_owned(),
            runtime_version: "test".to_owned(),
            entrypoint: entrypoint.to_owned(),
            args: Vec::new(),
            stdin: Bytes::new(),
            archive_targz: Bytes::new(),
            limits: JobLimits {
                compile_timeout: Duration::from_secs(30),
                run_timeout: Duration::from_secs(5),
                memory_limit_bytes: 256 * 1024 * 1024,
                cpu_millis: 1000,
                max_output_bytes: 1024 * 1024,
            },
            created_at: Utc::now(),
            started_at: None,
            finished_at: None,
        }
    }

    fn archive_with(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut targz = Vec::new();
        {
            let encoder = GzEncoder::new(&mut targz, Compression::default());
            let mut builder = Builder::new(encoder);
            for (path, bytes) in files {
                append_file(&mut builder, path, bytes);
            }
            let encoder = builder.into_inner().expect("finish tar");
            encoder.finish().expect("finish gzip");
        }
        targz
    }

    fn archive_with_raw_file(path: &str, bytes: &[u8], entry_type: EntryType) -> Vec<u8> {
        let mut targz = Vec::new();
        {
            let encoder = GzEncoder::new(&mut targz, Compression::default());
            let mut builder = Builder::new(encoder);
            let mut header = Header::new_gnu();
            header.set_entry_type(entry_type);
            header.set_size(bytes.len() as u64);
            header.set_mode(0o644);
            header.as_mut_bytes()[..path.len()].copy_from_slice(path.as_bytes());
            header.set_cksum();
            builder
                .append(&header, bytes)
                .expect("append raw fixture entry");
            let encoder = builder.into_inner().expect("finish tar");
            encoder.finish().expect("finish gzip");
        }
        targz
    }

    fn append_file<W: Write>(builder: &mut Builder<W>, path: &str, bytes: &[u8]) {
        let mut header = Header::new_gnu();
        header.set_entry_type(EntryType::Regular);
        header.set_size(bytes.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        builder
            .append_data(&mut header, path, bytes)
            .expect("append fixture file");
    }
}
