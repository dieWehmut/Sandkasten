use flate2::read::GzDecoder;
use laeufer_core::RunnerError;
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};
use tar::Archive;
use thiserror::Error;

use crate::constants::{
    DEFAULT_MAX_ARCHIVE_BYTES, DEFAULT_MAX_ARCHIVE_FILES, RUNNER_BIN_DIR, RUNNER_CACHE_DIR,
    RUNNER_SHARED_DIR, RUNNER_TMP_DIR,
};
use crate::language::normalize_language;

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

pub(crate) fn validate_archive(
    language: &str,
    archive_targz: &[u8],
    limits: ArchiveLimits,
) -> Result<ArchiveLayout, ArchiveError> {
    inspect_archive(archive_targz, limits, archive_requirements(language)?)
}

pub(crate) fn extract_archive(
    language: &str,
    archive_targz: &[u8],
    destination: &Path,
    limits: ArchiveLimits,
) -> Result<ArchiveLayout, ArchiveError> {
    let layout = validate_archive(language, archive_targz, limits)?;
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

pub(crate) fn checked_entrypoint(entrypoint: &str, language: &str) -> Result<PathBuf, RunnerError> {
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
        || path.starts_with(Path::new(RUNNER_SHARED_DIR))
        || path.starts_with(Path::new(RUNNER_TMP_DIR))
}
