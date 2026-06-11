mod archive;
mod constants;
mod dirs;
mod environment;
mod language;
mod planner;

pub use archive::{ArchiveError, ArchiveLayout, ArchiveLimits};

use laeufer_core::{BuildPlan, Job, LanguageRuntime, RunnerError};
use std::path::{Path, PathBuf};

use crate::archive::extract_archive;
use crate::constants::DEFAULT_COMPILE_MEMORY_LIMIT_BYTES;
use crate::dirs::{go_compile_cache_dir, prepare_go_compile_cache_dir, prepare_runner_dirs};
use crate::language::normalize_language;

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
        archive::validate_archive(language, archive_targz, ArchiveLimits::default())
    }

    pub fn extract_archive(
        language: &str,
        archive_targz: &[u8],
        destination: &Path,
        limits: ArchiveLimits,
    ) -> Result<ArchiveLayout, ArchiveError> {
        extract_archive(language, archive_targz, destination, limits)
    }

    pub fn plan(
        job: &Job,
        source_dir: PathBuf,
        compile_memory_limit_bytes: u64,
    ) -> Result<BuildPlan, RunnerError> {
        planner::plan(job, source_dir, compile_memory_limit_bytes)
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
        if language == "go" {
            prepare_go_compile_cache_dir(&go_compile_cache_dir(&job_dir))
                .map_err(|error| RunnerError::System(error.to_string()))?;
        }

        Self::plan(job, job_dir, self.compile_memory_limit_bytes)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SprachenRuntimeOptions {
    pub archive_limits: ArchiveLimits,
    pub compile_memory_limit_bytes: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use bytes::Bytes;
    use chrono::Utc;
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use laeufer_core::{JobLimits, JobStatus, RunnerError, SeccompProfile};
    use std::fs;
    use std::io::Write;
    use std::time::Duration;
    use tar::{Builder, EntryType, Header};
    use uuid::Uuid;

    use crate::constants::{RUNNER_BIN_DIR, RUNNER_TMP_DIR};
    use crate::dirs::prepare_runner_dirs;

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
        for path in [
            ".laeufer-bin/main",
            ".laeufer-cache/item",
            ".laeufer-shared/go-build/item",
            ".laeufer-tmp/item",
        ] {
            let archive = archive_with(&[(path, b"owned\n".as_slice())]);

            let err =
                SprachenRuntime::validate_archive("python", &archive).expect_err("invalid archive");

            assert!(matches!(err, ArchiveError::ReservedPath(_)));
        }
    }

    #[test]
    fn archive_rejects_path_traversal() {
        let archive = archive_with_raw_file("../escape", b"nope", EntryType::Regular);

        let err =
            SprachenRuntime::validate_archive("python", &archive).expect_err("invalid archive");

        assert!(matches!(err, ArchiveError::UnsafePath(_)));
    }

    #[cfg(unix)]
    #[test]
    fn prepared_runner_dirs_allow_unprivileged_job_writes() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().expect("tempdir");

        prepare_runner_dirs(dir.path()).expect("prepare runner dirs");

        for path in [
            dir.path().to_path_buf(),
            dir.path().join(RUNNER_BIN_DIR),
            dir.path().join(RUNNER_TMP_DIR),
        ] {
            let mode = fs::metadata(&path).expect("metadata").permissions().mode();
            assert_eq!(mode & 0o777, 0o777, "{path:?}");
        }
    }

    #[test]
    fn python_plan_checks_syntax_without_bytecode_write() {
        let job = job("python", "main.py");
        let plan =
            SprachenRuntime::plan(&job, PathBuf::from("/tmp/job/src"), 128 * 1024 * 1024).unwrap();

        assert_eq!(plan.compile.program, "python3");
        assert_eq!(plan.compile.args[0], "-c");
        assert_eq!(plan.compile.seccomp_profile, SeccompProfile::Compile);
        assert_eq!(plan.run.program, "python3");
        assert_eq!(plan.run.args[0], "-B");
        assert_eq!(plan.run.seccomp_profile, SeccompProfile::Run);
        assert!(plan
            .run
            .env
            .iter()
            .any(|(key, value)| key == "PYTHONDONTWRITEBYTECODE" && value == "1"));
    }

    #[test]
    fn go_plan_uses_shared_compile_cache_only_for_compile_phase() {
        let job = job("go", ".");
        let plan =
            SprachenRuntime::plan(&job, PathBuf::from("/work/job/src"), 128 * 1024 * 1024).unwrap();

        assert!(plan
            .compile
            .env
            .iter()
            .any(|(key, value)| key == "CGO_ENABLED" && value == "0"));
        assert!(plan
            .compile
            .env
            .iter()
            .any(|(key, value)| key == "GOFLAGS" && value == "-buildvcs=false"));
        assert!(plan
            .compile
            .env
            .iter()
            .any(|(key, value)| key == "GOTOOLCHAIN" && value == "local"));
        assert!(plan
            .compile
            .env
            .iter()
            .any(|(key, value)| key == "GOCACHE" && value == "/work/.laeufer-shared/go-build"));
        assert!(!plan.run.env.iter().any(|(key, _)| key == "GOCACHE"));
    }

    #[test]
    fn bash_plan_checks_syntax_then_runs_without_profiles() {
        let job = job("shell", "main.sh");
        let plan =
            SprachenRuntime::plan(&job, PathBuf::from("/tmp/job/src"), 128 * 1024 * 1024).unwrap();

        assert_eq!(plan.compile.program, "bash");
        assert_eq!(plan.compile.args, vec!["-n", "main.sh"]);
        assert_eq!(plan.compile.seccomp_profile, SeccompProfile::Compile);
        assert_eq!(plan.run.program, "bash");
        assert_eq!(plan.run.args[0], "--noprofile");
        assert_eq!(plan.run.args[1], "--norc");
        assert_eq!(plan.run.args[2], "main.sh");
        assert_eq!(plan.run.seccomp_profile, SeccompProfile::Run);
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
    fn r_plan_parses_then_runs_with_rscript_vanilla() {
        let job = job("r", "main.R");
        let plan =
            SprachenRuntime::plan(&job, PathBuf::from("/tmp/job/src"), 128 * 1024 * 1024).unwrap();

        assert_eq!(plan.compile.program, "Rscript");
        assert_eq!(plan.compile.args[0], "--vanilla");
        assert_eq!(plan.compile.args[1], "-e");
        assert_eq!(plan.compile.args.last().map(String::as_str), Some("main.R"));
        assert_eq!(plan.run.program, "Rscript");
        assert_eq!(plan.run.args[0], "--vanilla");
        assert_eq!(plan.run.args[1], "main.R");
    }

    #[test]
    fn racket_plan_compiles_with_private_cache_then_runs() {
        let job = job("rkt", "main.rkt");
        let plan =
            SprachenRuntime::plan(&job, PathBuf::from("/tmp/job/src"), 128 * 1024 * 1024).unwrap();

        assert_eq!(plan.compile.program, "raco");
        assert_eq!(plan.compile.args, vec!["make", "main.rkt"]);
        assert_eq!(plan.run.program, "racket");
        assert_eq!(plan.run.args, vec!["-t", "main.rkt"]);
        assert!(plan
            .compile
            .env
            .iter()
            .any(|(key, value)| key == "PLTUSERHOME" && value.ends_with("racket-addons")));
        assert!(plan
            .compile
            .env
            .iter()
            .any(|(key, value)| key == "PLTCOMPILEDROOTS" && value.ends_with("racket-compiled")));
    }

    #[test]
    fn ruby_plan_checks_syntax_and_disables_gems() {
        let job = job("rb", "main.rb");
        let plan =
            SprachenRuntime::plan(&job, PathBuf::from("/tmp/job/src"), 128 * 1024 * 1024).unwrap();

        assert_eq!(plan.compile.program, "ruby");
        assert_eq!(plan.compile.args, vec!["-c", "main.rb"]);
        assert_eq!(plan.run.program, "ruby");
        assert_eq!(plan.run.args[0], "--disable=gems");
        assert_eq!(plan.run.args[1], "main.rb");
        assert!(plan
            .run
            .env
            .iter()
            .any(|(key, value)| key == "RUBYOPT" && value == "--disable=gems"));
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
    fn coq_plan_checks_file_with_coqc_and_confirms_vo_output() {
        let job = job("coqc", "main.v");
        let plan =
            SprachenRuntime::plan(&job, PathBuf::from("/tmp/job/src"), 128 * 1024 * 1024).unwrap();

        assert_eq!(plan.compile.program, "coqc");
        assert_eq!(plan.compile.args[0], "-q");
        assert!(plan.compile.args.iter().any(|arg| arg == "-R"));
        assert_eq!(plan.compile.memory_limit_bytes, 128 * 1024 * 1024);
        assert_eq!(plan.run.program, "test");
        assert_eq!(plan.run.args[0], "-f");
        assert!(plan.run.args[1].ends_with("main.vo"));
    }

    #[test]
    fn scala_plan_compiles_classes_and_limits_jvm_cpu() {
        let job = job("sc", "Main.scala");
        let plan =
            SprachenRuntime::plan(&job, PathBuf::from("/tmp/job/src"), 128 * 1024 * 1024).unwrap();

        assert_eq!(plan.compile.program, "scalac");
        assert!(plan
            .compile
            .args
            .iter()
            .any(|arg| arg == "-J-XX:ActiveProcessorCount=1"));
        assert!(plan.compile.args.iter().any(|arg| arg == "-d"));
        assert_eq!(plan.compile.memory_limit_bytes, 128 * 1024 * 1024);
        assert_eq!(plan.run.program, "scala");
        assert!(plan
            .run
            .args
            .iter()
            .any(|arg| arg == "-Dscala.usejavacp=true"));
        assert!(plan.run.args.iter().any(|arg| arg == "Main"));
    }

    #[test]
    fn sql_plan_runs_sqlite_in_safe_mode_from_entrypoint_stdin() {
        let job = job("sqlite3", "main.sql");
        let plan =
            SprachenRuntime::plan(&job, PathBuf::from("/tmp/job/src"), 128 * 1024 * 1024).unwrap();

        assert_eq!(plan.compile.program, "bash");
        assert!(plan.compile.args.iter().any(|arg| arg == "test -r \"$1\""));
        assert_eq!(plan.run.program, "bash");
        assert!(plan
            .run
            .args
            .iter()
            .any(|arg| arg.contains("sqlite3 -batch -bail -safe :memory:")));
        assert_eq!(plan.run.args.last().map(String::as_str), Some("main.sql"));
    }

    #[test]
    fn kotlin_plan_builds_jar_and_runs_with_java() {
        let job = job("kt", "Main.kt");
        let plan =
            SprachenRuntime::plan(&job, PathBuf::from("/tmp/job/src"), 128 * 1024 * 1024).unwrap();

        assert_eq!(plan.compile.program, "kotlinc");
        assert!(plan
            .compile
            .args
            .iter()
            .any(|arg| arg == "-include-runtime"));
        assert!(plan
            .compile
            .args
            .iter()
            .any(|arg| arg.ends_with(".laeufer-bin/main.jar")));
        assert_eq!(plan.compile.memory_limit_bytes, 128 * 1024 * 1024);
        assert_eq!(plan.run.program, "java");
        assert!(plan.run.args.iter().any(|arg| arg == "-jar"));
        assert!(plan
            .run
            .args
            .iter()
            .any(|arg| arg.ends_with(".laeufer-bin/main.jar")));
    }

    #[test]
    fn julia_plan_parses_without_startup_files_and_uses_private_depot() {
        let job = job("jl", "main.jl");
        let plan =
            SprachenRuntime::plan(&job, PathBuf::from("/tmp/job/src"), 128 * 1024 * 1024).unwrap();

        assert_eq!(plan.compile.program, "julia");
        assert!(plan
            .compile
            .args
            .iter()
            .any(|arg| arg == "--startup-file=no"));
        assert!(plan
            .compile
            .args
            .iter()
            .any(|arg| arg == "--history-file=no"));
        assert!(plan.compile.args.iter().any(|arg| arg == "--compile=min"));
        assert!(plan
            .compile
            .args
            .iter()
            .any(|arg| arg.contains("Meta.parseall")));
        assert!(plan
            .compile
            .args
            .iter()
            .any(|arg| arg.contains(":incomplete")));
        assert_eq!(plan.run.program, "julia");
        assert!(plan.run.args.iter().any(|arg| arg == "--optimize=0"));
        assert!(plan
            .run
            .env
            .iter()
            .any(|(key, value)| key == "JULIA_DEPOT_PATH" && value.ends_with("julia-depot")));
        assert!(plan
            .run
            .env
            .iter()
            .any(|(key, value)| key == "JULIA_PKG_PRECOMPILE_AUTO" && value == "0"));
    }

    #[test]
    fn lean4_plan_checks_to_olean_then_runs() {
        let job = job("lean", "Main.lean");
        let plan =
            SprachenRuntime::plan(&job, PathBuf::from("/tmp/job/src"), 128 * 1024 * 1024).unwrap();

        assert_eq!(plan.compile.program, "lean");
        assert_eq!(plan.compile.args[0], "-o");
        assert!(plan
            .compile
            .args
            .iter()
            .any(|arg| arg.ends_with(".laeufer-bin/main.olean")));
        assert_eq!(plan.compile.memory_limit_bytes, 128 * 1024 * 1024);
        assert_eq!(plan.run.program, "lean");
        assert_eq!(plan.run.args[0], "--run");
        assert_eq!(plan.run.args[1], "Main.lean");
    }

    #[test]
    fn lua_plan_checks_syntax_with_luac_then_runs_with_lua() {
        let job = job("lua5.4", "main.lua");
        let plan =
            SprachenRuntime::plan(&job, PathBuf::from("/tmp/job/src"), 128 * 1024 * 1024).unwrap();

        assert_eq!(plan.compile.program, "luac");
        assert_eq!(plan.compile.args, vec!["-p", "main.lua"]);
        assert_eq!(plan.run.program, "lua");
        assert_eq!(plan.run.args[0], "main.lua");
    }

    #[test]
    fn php_plan_lints_then_runs_without_cli_opcache() {
        let job = job("php8.2", "main.php");
        let plan =
            SprachenRuntime::plan(&job, PathBuf::from("/tmp/job/src"), 128 * 1024 * 1024).unwrap();

        assert_eq!(plan.compile.program, "php");
        assert!(plan.compile.args.iter().any(|arg| arg == "-l"));
        assert!(plan
            .compile
            .args
            .iter()
            .any(|arg| arg == "opcache.enable_cli=0"));
        assert_eq!(plan.run.program, "php");
        assert!(plan
            .run
            .args
            .iter()
            .any(|arg| arg == "opcache.enable_cli=0"));
        assert_eq!(plan.run.args.last().map(String::as_str), Some("main.php"));
    }

    #[test]
    fn prolog_plan_parses_terms_without_consulting_then_runs_main() {
        let job = job("swipl", "main.pl");
        let plan =
            SprachenRuntime::plan(&job, PathBuf::from("/tmp/job/src"), 128 * 1024 * 1024).unwrap();

        assert_eq!(plan.compile.program, "swipl");
        assert!(plan.compile.args.iter().any(|arg| arg == "--no-packs"));
        assert!(plan
            .compile
            .args
            .iter()
            .any(|arg| arg.contains("read_term")));
        assert!(!plan.compile.args.iter().any(|arg| arg == "-s"));
        assert_eq!(plan.run.program, "swipl");
        assert!(plan.run.args.iter().any(|arg| arg == "-s"));
        assert!(plan.run.args.iter().any(|arg| arg == "main"));
        assert!(plan.run.args.iter().any(|arg| arg == "halt"));
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
