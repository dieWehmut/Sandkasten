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
const DEFAULT_MAX_ARCHIVE_BYTES: u64 = 64 * 1024 * 1024;
const DEFAULT_MAX_ARCHIVE_FILES: usize = 20_000;

#[derive(Clone, Debug)]
pub struct GoRuntime {
    work_root: PathBuf,
    limits: ArchiveLimits,
}

impl GoRuntime {
    pub fn new(work_root: impl Into<PathBuf>) -> Self {
        Self {
            work_root: work_root.into(),
            limits: ArchiveLimits::default(),
        }
    }

    pub fn with_limits(work_root: impl Into<PathBuf>, limits: ArchiveLimits) -> Self {
        Self {
            work_root: work_root.into(),
            limits,
        }
    }

    pub fn validate_archive(archive_targz: &[u8]) -> Result<ArchiveLayout, GoArchiveError> {
        inspect_archive(archive_targz, ArchiveLimits::default())
    }

    pub fn extract_archive(
        archive_targz: &[u8],
        destination: &Path,
        limits: ArchiveLimits,
    ) -> Result<ArchiveLayout, GoArchiveError> {
        let layout = inspect_archive(archive_targz, limits)?;
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
                return Err(GoArchiveError::UnsafePath(normalized));
            }
        }

        Ok(layout)
    }

    pub fn plan(job: &Job, source_dir: PathBuf) -> BuildPlan {
        let binary_path = source_dir.join(RUNNER_BIN_DIR).join("main");
        let env = runner_env(&source_dir);
        let compile = CommandPlan {
            program: "go".to_owned(),
            args: vec![
                "build".to_owned(),
                "-mod=vendor".to_owned(),
                "-trimpath".to_owned(),
                "-o".to_owned(),
                binary_path.to_string_lossy().into_owned(),
                job.entrypoint.clone(),
            ],
            env: env.clone(),
            cwd: source_dir.clone(),
            stdin: Default::default(),
            timeout: job.limits.compile_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
            cpu_millis: job.limits.cpu_millis,
            max_output_bytes: job.limits.max_output_bytes,
        };
        let run = CommandPlan {
            program: binary_path.to_string_lossy().into_owned(),
            args: job.args.clone(),
            env,
            cwd: source_dir,
            stdin: job.stdin.clone(),
            timeout: job.limits.run_timeout,
            memory_limit_bytes: job.limits.memory_limit_bytes,
            cpu_millis: job.limits.cpu_millis,
            max_output_bytes: job.limits.max_output_bytes,
        };

        BuildPlan { compile, run }
    }
}

#[async_trait::async_trait]
impl LanguageRuntime for GoRuntime {
    async fn prepare(&self, job: &Job) -> Result<BuildPlan, RunnerError> {
        if job.language != "go" {
            return Err(RunnerError::Validation(format!(
                "unsupported language {:?}",
                job.language
            )));
        }

        let job_dir = self.work_root.join(job.job_id.to_string()).join("src");
        Self::extract_archive(&job.archive_targz, &job_dir, self.limits)
            .map_err(|error| RunnerError::Validation(error.to_string()))?;
        prepare_runner_dirs(&job_dir).map_err(|error| RunnerError::System(error.to_string()))?;

        Ok(Self::plan(job, job_dir))
    }
}

fn prepare_runner_dirs(job_dir: &Path) -> std::io::Result<()> {
    for dirname in [RUNNER_BIN_DIR, RUNNER_CACHE_DIR, RUNNER_TMP_DIR] {
        let path = job_dir.join(dirname);
        fs::create_dir_all(&path)?;
        allow_unprivileged_write(&path)?;
    }
    Ok(())
}

fn runner_env(job_dir: &Path) -> Vec<(String, String)> {
    vec![
        (
            "PATH".to_owned(),
            std::env::var("PATH")
                .unwrap_or_else(|_| "/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin".to_owned()),
        ),
        (
            "GOCACHE".to_owned(),
            job_dir
                .join(RUNNER_CACHE_DIR)
                .to_string_lossy()
                .into_owned(),
        ),
        (
            "GOTMPDIR".to_owned(),
            job_dir.join(RUNNER_TMP_DIR).to_string_lossy().into_owned(),
        ),
        (
            "TMPDIR".to_owned(),
            job_dir.join(RUNNER_TMP_DIR).to_string_lossy().into_owned(),
        ),
        ("HOME".to_owned(), job_dir.to_string_lossy().into_owned()),
        ("GONOSUMDB".to_owned(), "*".to_owned()),
        ("GONOPROXY".to_owned(), "*".to_owned()),
    ]
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ArchiveLayout {
    pub file_count: usize,
    pub unpacked_bytes: u64,
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

#[derive(Debug, Error)]
pub enum GoArchiveError {
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

fn inspect_archive(
    archive_targz: &[u8],
    limits: ArchiveLimits,
) -> Result<ArchiveLayout, GoArchiveError> {
    if archive_targz.len() as u64 > limits.max_archive_bytes {
        return Err(GoArchiveError::TooLarge {
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
                return Err(GoArchiveError::TooManyFiles {
                    limit: limits.max_files,
                });
            }
            unpacked_bytes = unpacked_bytes.saturating_add(entry.header().size()?);
            if unpacked_bytes > limits.max_archive_bytes {
                return Err(GoArchiveError::TooLarge {
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

    if !has_go_mod {
        return Err(GoArchiveError::MissingGoMod);
    }
    if !has_vendor {
        return Err(GoArchiveError::MissingVendor);
    }

    Ok(ArchiveLayout {
        file_count,
        unpacked_bytes,
    })
}

fn checked_entry_path<R: Read>(entry: &tar::Entry<'_, R>) -> Result<PathBuf, GoArchiveError> {
    let entry_type = entry.header().entry_type();
    let raw_path = entry.path()?.into_owned();
    let normalized = normalize_archive_path(&raw_path)?;

    if normalized.starts_with(Path::new(RUNNER_BIN_DIR)) {
        return Err(GoArchiveError::ReservedPath(normalized));
    }

    if entry_type.is_file() || entry_type.is_dir() {
        Ok(normalized)
    } else {
        Err(GoArchiveError::UnsupportedEntry {
            path: normalized,
            entry_type: entry_type.as_byte(),
        })
    }
}

fn normalize_archive_path(path: &Path) -> Result<PathBuf, GoArchiveError> {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => normalized.push(part),
            Component::CurDir => {}
            Component::Prefix(_) | Component::RootDir | Component::ParentDir => {
                return Err(GoArchiveError::UnsafePath(path.to_path_buf()));
            }
        }
    }
    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::io::Write;
    use tar::{Builder, EntryType, Header};

    #[test]
    fn accepts_project_with_go_mod_and_vendor() {
        let archive = archive_with(&[
            ("go.mod", b"module example.com/demo\n".as_slice()),
            ("main.go", b"package main\nfunc main(){}\n".as_slice()),
            ("vendor/modules.txt", b"# vendor\n".as_slice()),
        ]);

        let layout = GoRuntime::validate_archive(&archive).expect("valid archive");

        assert_eq!(layout.file_count, 3);
        assert!(layout.unpacked_bytes > 0);
    }

    #[test]
    fn rejects_missing_go_mod() {
        let archive = archive_with(&[("vendor/modules.txt", b"# vendor\n".as_slice())]);

        let err = GoRuntime::validate_archive(&archive).expect_err("invalid archive");

        assert!(matches!(err, GoArchiveError::MissingGoMod));
    }

    #[test]
    fn rejects_missing_vendor() {
        let archive = archive_with(&[("go.mod", b"module example.com/demo\n".as_slice())]);

        let err = GoRuntime::validate_archive(&archive).expect_err("invalid archive");

        assert!(matches!(err, GoArchiveError::MissingVendor));
    }

    #[test]
    fn rejects_path_traversal() {
        let archive = archive_with_raw_file(
            "../escape",
            b"nope",
            &[
                ("go.mod", b"module example.com/demo\n".as_slice()),
                ("vendor/modules.txt", b"# vendor\n".as_slice()),
            ],
        );

        let err = GoRuntime::validate_archive(&archive).expect_err("invalid archive");

        assert!(matches!(err, GoArchiveError::UnsafePath(_)));
    }

    #[test]
    fn rejects_reserved_runner_path() {
        let archive = archive_with(&[
            ("go.mod", b"module example.com/demo\n".as_slice()),
            (".laeufer-bin/main", b"nope".as_slice()),
            ("vendor/modules.txt", b"# vendor\n".as_slice()),
        ]);

        let err = GoRuntime::validate_archive(&archive).expect_err("invalid archive");

        assert!(matches!(err, GoArchiveError::ReservedPath(_)));
    }

    #[test]
    fn rejects_symlink_entries() {
        let archive = archive_with_special(
            "link",
            EntryType::Symlink,
            Some("../outside"),
            &[
                ("go.mod", b"module example.com/demo\n".as_slice()),
                ("vendor/modules.txt", b"# vendor\n".as_slice()),
            ],
        );

        let err = GoRuntime::validate_archive(&archive).expect_err("invalid archive");

        assert!(matches!(err, GoArchiveError::UnsupportedEntry { .. }));
    }

    #[test]
    fn rejects_hardlink_entries() {
        let archive = archive_with_special(
            "hardlink",
            EntryType::Link,
            Some("go.mod"),
            &[
                ("go.mod", b"module example.com/demo\n".as_slice()),
                ("vendor/modules.txt", b"# vendor\n".as_slice()),
            ],
        );

        let err = GoRuntime::validate_archive(&archive).expect_err("invalid archive");

        assert!(matches!(err, GoArchiveError::UnsupportedEntry { .. }));
    }

    #[test]
    fn rejects_device_entries() {
        let archive = archive_with_special(
            "device",
            EntryType::Char,
            None,
            &[
                ("go.mod", b"module example.com/demo\n".as_slice()),
                ("vendor/modules.txt", b"# vendor\n".as_slice()),
            ],
        );

        let err = GoRuntime::validate_archive(&archive).expect_err("invalid archive");

        assert!(matches!(err, GoArchiveError::UnsupportedEntry { .. }));
    }

    #[test]
    fn rejects_too_many_files() {
        let archive = archive_with(&[
            ("go.mod", b"module example.com/demo\n".as_slice()),
            ("main.go", b"package main\nfunc main(){}\n".as_slice()),
            ("vendor/modules.txt", b"# vendor\n".as_slice()),
        ]);

        let err = inspect_archive(
            &archive,
            ArchiveLimits {
                max_archive_bytes: 1024 * 1024,
                max_files: 2,
            },
        )
        .expect_err("too many files");

        assert!(matches!(err, GoArchiveError::TooManyFiles { limit: 2 }));
    }

    fn archive_with(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut targz = Vec::new();
        {
            let encoder = GzEncoder::new(&mut targz, Compression::default());
            let mut builder = Builder::new(encoder);

            for (path, body) in files {
                append_file(&mut builder, path, body);
            }

            let encoder = builder.into_inner().expect("finish tar");
            encoder.finish().expect("finish gzip");
        }
        targz
    }

    fn archive_with_special(
        path: &str,
        entry_type: EntryType,
        link_name: Option<&str>,
        regular_files: &[(&str, &[u8])],
    ) -> Vec<u8> {
        let mut targz = Vec::new();
        {
            let encoder = GzEncoder::new(&mut targz, Compression::default());
            let mut builder = Builder::new(encoder);

            for (file_path, body) in regular_files {
                append_file(&mut builder, file_path, body);
            }

            let mut header = Header::new_gnu();
            header.set_entry_type(entry_type);
            header.set_size(0);
            header.set_mode(0o777);
            if let Some(link_name) = link_name {
                header.set_link_name(link_name).expect("set link name");
            }
            header.set_cksum();
            builder
                .append_data(&mut header, path, std::io::empty())
                .expect("append special entry");

            let encoder = builder.into_inner().expect("finish tar");
            encoder.finish().expect("finish gzip");
        }
        targz
    }

    fn archive_with_raw_file(path: &str, body: &[u8], regular_files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut targz = Vec::new();
        {
            let encoder = GzEncoder::new(&mut targz, Compression::default());
            let mut builder = Builder::new(encoder);

            for (file_path, file_body) in regular_files {
                append_file(&mut builder, file_path, file_body);
            }

            let mut header = Header::new_gnu();
            header.set_size(body.len() as u64);
            header.set_mode(0o644);
            header.set_entry_type(EntryType::Regular);
            header.as_mut_bytes()[..path.len()].copy_from_slice(path.as_bytes());
            header.set_cksum();
            builder
                .append(&header, body)
                .expect("append raw fixture entry");

            let encoder = builder.into_inner().expect("finish tar");
            encoder.finish().expect("finish gzip");
        }
        targz
    }

    fn append_file<W: Write>(builder: &mut Builder<W>, path: &str, body: &[u8]) {
        let mut header = Header::new_gnu();
        header.set_size(body.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        builder
            .append_data(&mut header, path, body)
            .expect("append fixture");
    }
}
