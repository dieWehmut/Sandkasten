use async_trait::async_trait;
use bytes::Bytes;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::cmp;
use std::fmt;
use std::path::PathBuf;
use std::time::Duration;
use thiserror::Error;
use uuid::Uuid;

pub type JobId = Uuid;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct RunnerConfig {
    pub runner_id: String,
    pub database_url: String,
    pub poll_interval: Duration,
    pub lease_ttl: Duration,
    pub work_dir: PathBuf,
    pub max_archive_bytes: u64,
    pub max_archive_files: usize,
}

impl RunnerConfig {
    pub fn from_env() -> Result<Self, ConfigError> {
        let runner_id = std::env::var("LAEUFER_RUNNER_ID")
            .or_else(|_| std::env::var("HOSTNAME"))
            .unwrap_or_else(|_| format!("laeufer-{}", std::process::id()));
        let database_url =
            std::env::var("DATABASE_URL").map_err(|_| ConfigError::MissingDatabaseUrl)?;
        let poll_interval = millis_env("LAEUFER_POLL_INTERVAL_MS", 1_000)?;
        let lease_ttl = millis_env("LAEUFER_LEASE_TTL_MS", 60_000)?;
        let work_dir = std::env::var("LAEUFER_WORK_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| std::env::temp_dir().join("laeufer"));
        let max_archive_bytes = u64_env("LAEUFER_MAX_ARCHIVE_BYTES", 64 * 1024 * 1024)?;
        let max_archive_files = usize_env("LAEUFER_MAX_ARCHIVE_FILES", 20_000)?;

        Ok(Self {
            runner_id,
            database_url,
            poll_interval,
            lease_ttl,
            work_dir,
            max_archive_bytes,
            max_archive_files,
        })
    }
}

fn millis_env(name: &'static str, default_ms: u64) -> Result<Duration, ConfigError> {
    match std::env::var(name) {
        Ok(value) => {
            let millis = value
                .parse::<u64>()
                .map_err(|_| ConfigError::InvalidDuration { name, value })?;
            Ok(Duration::from_millis(millis))
        }
        Err(_) => Ok(Duration::from_millis(default_ms)),
    }
}

fn u64_env(name: &'static str, default: u64) -> Result<u64, ConfigError> {
    match std::env::var(name) {
        Ok(value) => value
            .parse::<u64>()
            .map_err(|_| ConfigError::InvalidInteger { name, value }),
        Err(_) => Ok(default),
    }
}

fn usize_env(name: &'static str, default: usize) -> Result<usize, ConfigError> {
    match std::env::var(name) {
        Ok(value) => value
            .parse::<usize>()
            .map_err(|_| ConfigError::InvalidInteger { name, value }),
        Err(_) => Ok(default),
    }
}

#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum ConfigError {
    #[error("DATABASE_URL is required")]
    MissingDatabaseUrl,
    #[error("{name} must be an unsigned integer number of milliseconds, got {value:?}")]
    InvalidDuration { name: &'static str, value: String },
    #[error("{name} must be an unsigned integer, got {value:?}")]
    InvalidInteger { name: &'static str, value: String },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum JobStatus {
    Queued,
    Validating,
    Compiling,
    Running,
    Succeeded,
    CompileFailed,
    RuntimeFailed,
    TimeLimitExceeded,
    MemoryLimitExceeded,
    OutputLimitExceeded,
    Canceled,
    SystemError,
}

impl JobStatus {
    pub const ALL: [Self; 12] = [
        Self::Queued,
        Self::Validating,
        Self::Compiling,
        Self::Running,
        Self::Succeeded,
        Self::CompileFailed,
        Self::RuntimeFailed,
        Self::TimeLimitExceeded,
        Self::MemoryLimitExceeded,
        Self::OutputLimitExceeded,
        Self::Canceled,
        Self::SystemError,
    ];

    pub fn as_db_str(self) -> &'static str {
        match self {
            Self::Queued => "QUEUED",
            Self::Validating => "VALIDATING",
            Self::Compiling => "COMPILING",
            Self::Running => "RUNNING",
            Self::Succeeded => "SUCCEEDED",
            Self::CompileFailed => "COMPILE_FAILED",
            Self::RuntimeFailed => "RUNTIME_FAILED",
            Self::TimeLimitExceeded => "TIME_LIMIT_EXCEEDED",
            Self::MemoryLimitExceeded => "MEMORY_LIMIT_EXCEEDED",
            Self::OutputLimitExceeded => "OUTPUT_LIMIT_EXCEEDED",
            Self::Canceled => "CANCELED",
            Self::SystemError => "SYSTEM_ERROR",
        }
    }

    pub fn proto_name(self) -> &'static str {
        match self {
            Self::Queued => "JOB_STATUS_QUEUED",
            Self::Validating => "JOB_STATUS_VALIDATING",
            Self::Compiling => "JOB_STATUS_COMPILING",
            Self::Running => "JOB_STATUS_RUNNING",
            Self::Succeeded => "JOB_STATUS_SUCCEEDED",
            Self::CompileFailed => "JOB_STATUS_COMPILE_FAILED",
            Self::RuntimeFailed => "JOB_STATUS_RUNTIME_FAILED",
            Self::TimeLimitExceeded => "JOB_STATUS_TIME_LIMIT_EXCEEDED",
            Self::MemoryLimitExceeded => "JOB_STATUS_MEMORY_LIMIT_EXCEEDED",
            Self::OutputLimitExceeded => "JOB_STATUS_OUTPUT_LIMIT_EXCEEDED",
            Self::Canceled => "JOB_STATUS_CANCELED",
            Self::SystemError => "JOB_STATUS_SYSTEM_ERROR",
        }
    }

    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Succeeded
                | Self::CompileFailed
                | Self::RuntimeFailed
                | Self::TimeLimitExceeded
                | Self::MemoryLimitExceeded
                | Self::OutputLimitExceeded
                | Self::Canceled
                | Self::SystemError
        )
    }
}

impl fmt::Display for JobStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_db_str())
    }
}

impl TryFrom<&str> for JobStatus {
    type Error = StatusParseError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "QUEUED" | "JOB_STATUS_QUEUED" => Ok(Self::Queued),
            "VALIDATING" | "JOB_STATUS_VALIDATING" => Ok(Self::Validating),
            "COMPILING" | "JOB_STATUS_COMPILING" => Ok(Self::Compiling),
            "RUNNING" | "JOB_STATUS_RUNNING" => Ok(Self::Running),
            "SUCCEEDED" | "JOB_STATUS_SUCCEEDED" => Ok(Self::Succeeded),
            "COMPILE_FAILED" | "JOB_STATUS_COMPILE_FAILED" => Ok(Self::CompileFailed),
            "RUNTIME_FAILED" | "JOB_STATUS_RUNTIME_FAILED" => Ok(Self::RuntimeFailed),
            "TIME_LIMIT_EXCEEDED" | "JOB_STATUS_TIME_LIMIT_EXCEEDED" => {
                Ok(Self::TimeLimitExceeded)
            }
            "MEMORY_LIMIT_EXCEEDED" | "JOB_STATUS_MEMORY_LIMIT_EXCEEDED" => {
                Ok(Self::MemoryLimitExceeded)
            }
            "OUTPUT_LIMIT_EXCEEDED" | "JOB_STATUS_OUTPUT_LIMIT_EXCEEDED" => {
                Ok(Self::OutputLimitExceeded)
            }
            "CANCELED" | "JOB_STATUS_CANCELED" => Ok(Self::Canceled),
            "SYSTEM_ERROR" | "JOB_STATUS_SYSTEM_ERROR" => Ok(Self::SystemError),
            _ => Err(StatusParseError(value.to_owned())),
        }
    }
}

impl TryFrom<String> for JobStatus {
    type Error = StatusParseError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_from(value.as_str())
    }
}

#[derive(Clone, Debug, Error, Eq, PartialEq)]
#[error("unknown job status {0:?}")]
pub struct StatusParseError(pub String);

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct Job {
    pub job_id: JobId,
    pub status: JobStatus,
    pub language: String,
    pub runtime_version: String,
    pub entrypoint: String,
    pub args: Vec<String>,
    pub stdin: Bytes,
    pub archive_targz: Bytes,
    pub limits: JobLimits,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct JobLimits {
    pub compile_timeout: Duration,
    pub run_timeout: Duration,
    pub memory_limit_bytes: u64,
    pub cpu_millis: u32,
    pub max_output_bytes: u64,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct JobResult {
    pub stdout: Bytes,
    pub stderr: Bytes,
    pub compile_stdout: Bytes,
    pub compile_stderr: Bytes,
    pub exit_code: Option<i32>,
    pub signal: Option<i32>,
    pub wall_time: Duration,
    pub memory_peak_bytes: u64,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
}

impl JobResult {
    pub fn command_succeeded(&self) -> bool {
        self.exit_code == Some(0) && self.signal.is_none()
    }

    pub fn output_truncated(&self) -> bool {
        self.stdout_truncated || self.stderr_truncated
    }

    pub fn absorb_compile_output(&mut self, compile: JobResult) {
        self.compile_stdout = compile.stdout;
        self.compile_stderr = compile.stderr;
        self.wall_time += compile.wall_time;
        self.memory_peak_bytes = cmp::max(self.memory_peak_bytes, compile.memory_peak_bytes);
        self.stdout_truncated |= compile.stdout_truncated;
        self.stderr_truncated |= compile.stderr_truncated;
    }

    pub fn absorb_run_output(&mut self, run: JobResult) {
        self.stdout = run.stdout;
        self.stderr = run.stderr;
        self.exit_code = run.exit_code;
        self.signal = run.signal;
        self.wall_time += run.wall_time;
        self.memory_peak_bytes = cmp::max(self.memory_peak_bytes, run.memory_peak_bytes);
        self.stdout_truncated |= run.stdout_truncated;
        self.stderr_truncated |= run.stderr_truncated;
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommandPlan {
    pub program: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub cwd: PathBuf,
    pub stdin: Bytes,
    pub timeout: Duration,
    pub memory_limit_bytes: u64,
    pub cpu_millis: u32,
    pub max_output_bytes: u64,
}

impl CommandPlan {
    pub fn display_command(&self) -> String {
        let mut parts = Vec::with_capacity(self.args.len() + 1);
        parts.push(self.program.clone());
        parts.extend(self.args.iter().cloned());
        parts.join(" ")
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BuildPlan {
    pub compile: CommandPlan,
    pub run: CommandPlan,
}

#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum RunnerError {
    #[error("validation failed: {0}")]
    Validation(String),
    #[error("preflight failed: {0}")]
    Preflight(String),
    #[error("compile failed: {0}")]
    Compile(String),
    #[error("runtime failed: {0}")]
    Runtime(String),
    #[error("time limit exceeded: {0}")]
    TimeLimitExceeded(String),
    #[error("memory limit exceeded: {0}")]
    MemoryLimitExceeded(String),
    #[error("output limit exceeded: {0}")]
    OutputLimitExceeded(String),
    #[error("storage failed: {0}")]
    Store(String),
    #[error("system error: {0}")]
    System(String),
}

#[async_trait]
pub trait JobStore: Send + Sync {
    async fn lease_next(
        &self,
        runner_id: &str,
        lease_ttl: Duration,
    ) -> Result<Option<Job>, RunnerError>;

    async fn update_status(
        &self,
        job_id: JobId,
        status: JobStatus,
        message: &str,
    ) -> Result<(), RunnerError>;

    async fn finish(
        &self,
        job_id: JobId,
        status: JobStatus,
        result: JobResult,
        error_message: &str,
    ) -> Result<(), RunnerError>;
}

#[async_trait]
pub trait LanguageRuntime: Send + Sync {
    async fn prepare(&self, job: &Job) -> Result<BuildPlan, RunnerError>;
}

#[async_trait]
pub trait Sandbox: Send + Sync {
    async fn preflight(&self) -> Result<(), RunnerError>;
    async fn execute(&self, plan: &CommandPlan) -> Result<JobResult, RunnerError>;
}

pub fn terminal_status_from_error(error: &RunnerError) -> JobStatus {
    match error {
        RunnerError::Validation(_) | RunnerError::Runtime(_) => JobStatus::RuntimeFailed,
        RunnerError::Compile(_) => JobStatus::CompileFailed,
        RunnerError::TimeLimitExceeded(_) => JobStatus::TimeLimitExceeded,
        RunnerError::MemoryLimitExceeded(_) => JobStatus::MemoryLimitExceeded,
        RunnerError::OutputLimitExceeded(_) => JobStatus::OutputLimitExceeded,
        RunnerError::Preflight(_) | RunnerError::Store(_) | RunnerError::System(_) => {
            JobStatus::SystemError
        }
    }
}

pub fn terminal_status_from_compile_result(result: &JobResult) -> Option<JobStatus> {
    if result.output_truncated() {
        Some(JobStatus::OutputLimitExceeded)
    } else if result.command_succeeded() {
        None
    } else {
        Some(JobStatus::CompileFailed)
    }
}

pub fn terminal_status_from_run_result(result: &JobResult) -> JobStatus {
    if result.output_truncated() {
        JobStatus::OutputLimitExceeded
    } else if result.command_succeeded() {
        JobStatus::Succeeded
    } else {
        JobStatus::RuntimeFailed
    }
}

pub async fn execute_job<S, L, X>(
    store: &S,
    runtime: &L,
    sandbox: &X,
    job: Job,
) -> Result<JobStatus, RunnerError>
where
    S: JobStore + ?Sized,
    L: LanguageRuntime + ?Sized,
    X: Sandbox + ?Sized,
{
    let mut result = JobResult::default();

    store
        .update_status(job.job_id, JobStatus::Validating, "validating job archive")
        .await?;

    let plan = match runtime.prepare(&job).await {
        Ok(plan) => plan,
        Err(error) => {
            let status = terminal_status_from_error(&error);
            finish_error(store, job.job_id, result, error).await?;
            return Ok(status);
        }
    };

    store
        .update_status(job.job_id, JobStatus::Compiling, "compiling job")
        .await?;

    let compile_output = match sandbox.execute(&plan.compile).await {
        Ok(output) => output,
        Err(error) => {
            finish_error(store, job.job_id, result, error.clone()).await?;
            return Ok(terminal_status_from_error(&error));
        }
    };

    let compile_status = terminal_status_from_compile_result(&compile_output);
    result.absorb_compile_output(compile_output);
    if let Some(status) = compile_status {
        store
            .finish(job.job_id, status, result, "compile did not complete successfully")
            .await?;
        return Ok(status);
    }

    store
        .update_status(job.job_id, JobStatus::Running, "running job")
        .await?;

    let run_output = match sandbox.execute(&plan.run).await {
        Ok(output) => output,
        Err(error) => {
            finish_error(store, job.job_id, result, error.clone()).await?;
            return Ok(terminal_status_from_error(&error));
        }
    };

    result.absorb_run_output(run_output);
    let status = terminal_status_from_run_result(&result);
    let message = match status {
        JobStatus::Succeeded => "",
        JobStatus::OutputLimitExceeded => "job output exceeded configured limit",
        JobStatus::RuntimeFailed => "job process exited unsuccessfully",
        _ => "job finished with terminal status",
    };
    store.finish(job.job_id, status, result, message).await?;

    Ok(status)
}

async fn finish_error<S>(
    store: &S,
    job_id: JobId,
    result: JobResult,
    error: RunnerError,
) -> Result<(), RunnerError>
where
    S: JobStore + ?Sized,
{
    let status = terminal_status_from_error(&error);
    let message = error.to_string();
    store.finish(job_id, status, result, &message).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_maps_db_and_proto_names() {
        let status = JobStatus::TimeLimitExceeded;

        assert_eq!(status.as_db_str(), "TIME_LIMIT_EXCEEDED");
        assert_eq!(status.proto_name(), "JOB_STATUS_TIME_LIMIT_EXCEEDED");
        assert_eq!(
            JobStatus::try_from("JOB_STATUS_TIME_LIMIT_EXCEEDED"),
            Ok(status)
        );
        assert_eq!(JobStatus::try_from("TIME_LIMIT_EXCEEDED"), Ok(status));
    }

    #[test]
    fn all_statuses_match_known_database_values() {
        let db_values = [
            "QUEUED",
            "VALIDATING",
            "COMPILING",
            "RUNNING",
            "SUCCEEDED",
            "COMPILE_FAILED",
            "RUNTIME_FAILED",
            "TIME_LIMIT_EXCEEDED",
            "MEMORY_LIMIT_EXCEEDED",
            "OUTPUT_LIMIT_EXCEEDED",
            "CANCELED",
            "SYSTEM_ERROR",
        ];

        for (status, db_value) in JobStatus::ALL.into_iter().zip(db_values) {
            assert_eq!(status.as_db_str(), db_value);
            assert_eq!(JobStatus::try_from(db_value), Ok(status));
        }
    }

    #[test]
    fn terminal_statuses_match_proto_contract() {
        assert!(!JobStatus::Queued.is_terminal());
        assert!(!JobStatus::Running.is_terminal());
        assert!(JobStatus::Succeeded.is_terminal());
        assert!(JobStatus::SystemError.is_terminal());
    }

    #[test]
    fn maps_runner_errors_to_terminal_statuses() {
        assert_eq!(
            terminal_status_from_error(&RunnerError::TimeLimitExceeded("run".to_owned())),
            JobStatus::TimeLimitExceeded
        );
        assert_eq!(
            terminal_status_from_error(&RunnerError::OutputLimitExceeded("stdout".to_owned())),
            JobStatus::OutputLimitExceeded
        );
        assert_eq!(
            terminal_status_from_error(&RunnerError::Preflight("missing cgroup".to_owned())),
            JobStatus::SystemError
        );
    }

    #[test]
    fn maps_compile_results() {
        let ok = JobResult {
            exit_code: Some(0),
            ..JobResult::default()
        };
        let failed = JobResult {
            exit_code: Some(2),
            ..JobResult::default()
        };
        let truncated = JobResult {
            exit_code: Some(0),
            stdout_truncated: true,
            ..JobResult::default()
        };

        assert_eq!(terminal_status_from_compile_result(&ok), None);
        assert_eq!(
            terminal_status_from_compile_result(&failed),
            Some(JobStatus::CompileFailed)
        );
        assert_eq!(
            terminal_status_from_compile_result(&truncated),
            Some(JobStatus::OutputLimitExceeded)
        );
    }

    #[test]
    fn maps_run_results() {
        let ok = JobResult {
            exit_code: Some(0),
            ..JobResult::default()
        };
        let failed = JobResult {
            exit_code: Some(1),
            ..JobResult::default()
        };
        let signaled = JobResult {
            signal: Some(9),
            ..JobResult::default()
        };
        let truncated = JobResult {
            exit_code: Some(0),
            stderr_truncated: true,
            ..JobResult::default()
        };

        assert_eq!(terminal_status_from_run_result(&ok), JobStatus::Succeeded);
        assert_eq!(
            terminal_status_from_run_result(&failed),
            JobStatus::RuntimeFailed
        );
        assert_eq!(
            terminal_status_from_run_result(&signaled),
            JobStatus::RuntimeFailed
        );
        assert_eq!(
            terminal_status_from_run_result(&truncated),
            JobStatus::OutputLimitExceeded
        );
    }
}
