use async_trait::async_trait;
use bytes::Bytes;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::cmp;
use std::fmt;
use std::path::PathBuf;
use std::time::Duration;
use thiserror::Error;
use tokio::sync::watch;
use uuid::Uuid;

pub type JobId = Uuid;
pub type AttemptId = Uuid;
pub type CancellationReceiver = watch::Receiver<bool>;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct RunnerConfig {
    pub runner_id: String,
    pub database_url: String,
    pub poll_interval: Duration,
    pub lease_ttl: Duration,
    pub work_dir: PathBuf,
    pub max_archive_bytes: u64,
    pub max_archive_files: usize,
    pub compile_memory_limit_bytes: u64,
    pub max_attempts: u32,
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
        let compile_memory_limit_bytes =
            u64_env("LAEUFER_COMPILE_MEMORY_LIMIT_BYTES", 1024 * 1024 * 1024)?;
        let max_attempts = positive_u32_env("LAEUFER_MAX_ATTEMPTS", 3)?;

        Ok(Self {
            runner_id,
            database_url,
            poll_interval,
            lease_ttl,
            work_dir,
            max_archive_bytes,
            max_archive_files,
            compile_memory_limit_bytes,
            max_attempts,
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

fn positive_u32_env(name: &'static str, default: u32) -> Result<u32, ConfigError> {
    match std::env::var(name) {
        Ok(value) => positive_u32_value(name, value),
        Err(_) => Ok(default),
    }
}

fn positive_u32_value(name: &'static str, value: String) -> Result<u32, ConfigError> {
    let parsed = match value.parse::<u32>() {
        Ok(parsed) => parsed,
        Err(_) => return Err(ConfigError::InvalidInteger { name, value }),
    };
    if parsed == 0 {
        Err(ConfigError::InvalidPositiveInteger { name, value })
    } else {
        Ok(parsed)
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
    #[error("{name} must be a positive integer, got {value:?}")]
    InvalidPositiveInteger { name: &'static str, value: String },
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
            "TIME_LIMIT_EXCEEDED" | "JOB_STATUS_TIME_LIMIT_EXCEEDED" => Ok(Self::TimeLimitExceeded),
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
    pub attempt_id: AttemptId,
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
    pub cpu_usage_usec: u64,
    pub cpu_throttled_usec: u64,
    pub pids_peak: u64,
    pub memory_oom_kill_count: u64,
    pub cgroup_path: Option<String>,
    pub child_pid: Option<u32>,
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
        self.cpu_usage_usec = self.cpu_usage_usec.saturating_add(compile.cpu_usage_usec);
        self.cpu_throttled_usec = self
            .cpu_throttled_usec
            .saturating_add(compile.cpu_throttled_usec);
        self.pids_peak = cmp::max(self.pids_peak, compile.pids_peak);
        self.memory_oom_kill_count = self
            .memory_oom_kill_count
            .saturating_add(compile.memory_oom_kill_count);
        self.cgroup_path = compile.cgroup_path;
        self.child_pid = compile.child_pid;
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
        self.cpu_usage_usec = self.cpu_usage_usec.saturating_add(run.cpu_usage_usec);
        self.cpu_throttled_usec = self
            .cpu_throttled_usec
            .saturating_add(run.cpu_throttled_usec);
        self.pids_peak = cmp::max(self.pids_peak, run.pids_peak);
        self.memory_oom_kill_count = self
            .memory_oom_kill_count
            .saturating_add(run.memory_oom_kill_count);
        self.cgroup_path = run.cgroup_path;
        self.child_pid = run.child_pid;
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum SeccompProfile {
    Compile,
    Run,
}

impl SeccompProfile {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Compile => "compile",
            Self::Run => "run",
        }
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
    pub seccomp_profile: SeccompProfile,
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
    #[error("canceled: {0}")]
    Canceled(String),
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
        max_attempts: u32,
    ) -> Result<Option<Job>, RunnerError>;

    async fn update_status(
        &self,
        runner_id: &str,
        attempt_id: AttemptId,
        job_id: JobId,
        status: JobStatus,
        message: &str,
    ) -> Result<(), RunnerError>;

    async fn renew_lease(
        &self,
        runner_id: &str,
        attempt_id: AttemptId,
        job_id: JobId,
        lease_ttl: Duration,
    ) -> Result<(), RunnerError>;

    async fn current_status(&self, job_id: JobId) -> Result<Option<JobStatus>, RunnerError>;

    async fn finish(
        &self,
        runner_id: &str,
        attempt_id: AttemptId,
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
    async fn execute(
        &self,
        plan: &CommandPlan,
        cancel: &mut CancellationReceiver,
    ) -> Result<JobResult, RunnerError>;
}

pub fn terminal_status_from_error(error: &RunnerError) -> JobStatus {
    match error {
        RunnerError::Validation(_) | RunnerError::Runtime(_) => JobStatus::RuntimeFailed,
        RunnerError::Compile(_) => JobStatus::CompileFailed,
        RunnerError::TimeLimitExceeded(_) => JobStatus::TimeLimitExceeded,
        RunnerError::MemoryLimitExceeded(_) => JobStatus::MemoryLimitExceeded,
        RunnerError::OutputLimitExceeded(_) => JobStatus::OutputLimitExceeded,
        RunnerError::Canceled(_) => JobStatus::Canceled,
        RunnerError::Preflight(_) | RunnerError::Store(_) | RunnerError::System(_) => {
            JobStatus::SystemError
        }
    }
}

pub fn terminal_status_from_compile_result(result: &JobResult) -> Option<JobStatus> {
    if result.output_truncated() {
        Some(JobStatus::OutputLimitExceeded)
    } else if let Some(signal) = result.signal {
        Some(terminal_status_from_signal(signal, true))
    } else if result.command_succeeded() {
        None
    } else {
        Some(JobStatus::CompileFailed)
    }
}

pub fn terminal_status_from_run_result(result: &JobResult) -> JobStatus {
    if result.output_truncated() {
        JobStatus::OutputLimitExceeded
    } else if let Some(signal) = result.signal {
        terminal_status_from_signal(signal, false)
    } else if result.command_succeeded() {
        JobStatus::Succeeded
    } else {
        JobStatus::RuntimeFailed
    }
}

fn terminal_status_from_signal(signal: i32, compile_phase: bool) -> JobStatus {
    match signal {
        libc::SIGXCPU => JobStatus::TimeLimitExceeded,
        libc::SIGXFSZ => JobStatus::OutputLimitExceeded,
        _ if compile_phase => JobStatus::CompileFailed,
        _ => JobStatus::RuntimeFailed,
    }
}

pub fn terminal_message_from_compile_result(result: &JobResult, status: JobStatus) -> String {
    terminal_message_from_result(result, status, "compile")
}

pub fn terminal_message_from_run_result(result: &JobResult, status: JobStatus) -> String {
    terminal_message_from_result(result, status, "run")
}

fn terminal_message_from_result(result: &JobResult, status: JobStatus, phase: &str) -> String {
    if result.output_truncated() {
        return format!("{phase} output exceeded configured limit");
    }
    if let Some(signal) = result.signal {
        return signal_message(signal, phase);
    }
    match status {
        JobStatus::Succeeded => String::new(),
        JobStatus::CompileFailed => "compile did not complete successfully".to_owned(),
        JobStatus::RuntimeFailed => "job process exited unsuccessfully".to_owned(),
        JobStatus::TimeLimitExceeded => format!("{phase} exceeded CPU time rlimit"),
        JobStatus::OutputLimitExceeded => {
            format!("{phase} exceeded output or file-size limit")
        }
        _ => "job finished with terminal status".to_owned(),
    }
}

pub fn terminal_reason_from_result(status: JobStatus, result: &JobResult) -> String {
    if status == JobStatus::MemoryLimitExceeded && result.memory_oom_kill_count > 0 {
        return "memory_cgroup_oom".to_owned();
    }
    if result.output_truncated() {
        return "output_truncated".to_owned();
    }
    if let Some(signal) = result.signal {
        return signal_terminal_reason(signal);
    }
    if let Some(exit_code) = result.exit_code {
        if status == JobStatus::Succeeded {
            return "exit_code_0".to_owned();
        }
        return format!("exit_code_{exit_code}");
    }
    match status {
        JobStatus::TimeLimitExceeded => "timeout".to_owned(),
        JobStatus::MemoryLimitExceeded => "memory_limit".to_owned(),
        JobStatus::OutputLimitExceeded => "output_limit".to_owned(),
        JobStatus::Canceled => "canceled".to_owned(),
        JobStatus::SystemError => "system_error".to_owned(),
        JobStatus::CompileFailed => "compile_failed".to_owned(),
        JobStatus::RuntimeFailed => "runtime_failed".to_owned(),
        JobStatus::Succeeded => "succeeded".to_owned(),
        JobStatus::Queued | JobStatus::Validating | JobStatus::Compiling | JobStatus::Running => {
            "non_terminal".to_owned()
        }
    }
}

fn signal_terminal_reason(signal: i32) -> String {
    match signal {
        libc::SIGSYS => "seccomp_sigsys".to_owned(),
        libc::SIGXCPU => "cpu_rlimit_sigxcpu".to_owned(),
        libc::SIGXFSZ => "file_size_rlimit_sigxfsz".to_owned(),
        libc::SIGKILL => "signal_sigkill".to_owned(),
        libc::SIGTERM => "signal_sigterm".to_owned(),
        libc::SIGSEGV => "signal_sigsegv".to_owned(),
        libc::SIGBUS => "signal_sigbus".to_owned(),
        libc::SIGILL => "signal_sigill".to_owned(),
        libc::SIGABRT => "signal_sigabrt".to_owned(),
        _ => format!("signal_{signal}"),
    }
}

fn signal_message(signal: i32, phase: &str) -> String {
    match signal {
        libc::SIGSYS => format!("{phase} blocked by seccomp"),
        libc::SIGXCPU => format!("{phase} exceeded CPU time rlimit"),
        libc::SIGXFSZ => format!("{phase} exceeded file-size rlimit"),
        libc::SIGKILL => format!("{phase} killed by SIGKILL"),
        libc::SIGTERM => format!("{phase} terminated by SIGTERM"),
        libc::SIGSEGV => format!("{phase} segmentation fault"),
        libc::SIGBUS => format!("{phase} bus error"),
        libc::SIGILL => format!("{phase} illegal instruction"),
        libc::SIGABRT => format!("{phase} aborted"),
        _ => format!("{phase} terminated by signal {signal}"),
    }
}

pub async fn execute_job<S, L, X>(
    store: &S,
    runner_id: &str,
    runtime: &L,
    sandbox: &X,
    job: Job,
    cancel: &mut CancellationReceiver,
) -> Result<JobStatus, RunnerError>
where
    S: JobStore + ?Sized,
    L: LanguageRuntime + ?Sized,
    X: Sandbox + ?Sized,
{
    let mut result = JobResult::default();
    let attempt_id = job.attempt_id;

    store
        .update_status(
            runner_id,
            attempt_id,
            job.job_id,
            JobStatus::Validating,
            "validating job archive",
        )
        .await?;
    if cancellation_requested(cancel) {
        finish_canceled(
            store,
            runner_id,
            attempt_id,
            job.job_id,
            result,
            "job canceled while validating",
        )
        .await?;
        return Ok(JobStatus::Canceled);
    }

    let plan = match runtime.prepare(&job).await {
        Ok(plan) => plan,
        Err(error) => {
            let status = terminal_status_from_error(&error);
            finish_error(store, runner_id, attempt_id, job.job_id, result, error).await?;
            return Ok(status);
        }
    };
    if cancellation_requested(cancel) {
        finish_canceled(
            store,
            runner_id,
            attempt_id,
            job.job_id,
            result,
            "job canceled before compile",
        )
        .await?;
        return Ok(JobStatus::Canceled);
    }

    store
        .update_status(
            runner_id,
            attempt_id,
            job.job_id,
            JobStatus::Compiling,
            "compiling job",
        )
        .await?;

    let compile_output = match sandbox.execute(&plan.compile, cancel).await {
        Ok(output) => output,
        Err(RunnerError::Canceled(message)) => {
            let message = format!("job canceled during compile: {message}");
            finish_canceled(store, runner_id, attempt_id, job.job_id, result, &message).await?;
            return Ok(JobStatus::Canceled);
        }
        Err(error) => {
            finish_error(
                store,
                runner_id,
                attempt_id,
                job.job_id,
                result,
                error.clone(),
            )
            .await?;
            return Ok(terminal_status_from_error(&error));
        }
    };

    let compile_status = terminal_status_from_compile_result(&compile_output);
    let compile_message =
        compile_status.map(|status| terminal_message_from_compile_result(&compile_output, status));
    result.absorb_compile_output(compile_output);
    if let Some(status) = compile_status {
        let message = compile_message.unwrap_or_else(|| "compile failed".to_owned());
        store
            .finish(runner_id, attempt_id, job.job_id, status, result, &message)
            .await?;
        return Ok(status);
    }
    if cancellation_requested(cancel) {
        finish_canceled(
            store,
            runner_id,
            attempt_id,
            job.job_id,
            result,
            "job canceled before run",
        )
        .await?;
        return Ok(JobStatus::Canceled);
    }

    store
        .update_status(
            runner_id,
            attempt_id,
            job.job_id,
            JobStatus::Running,
            "running job",
        )
        .await?;

    let run_output = match sandbox.execute(&plan.run, cancel).await {
        Ok(output) => output,
        Err(RunnerError::Canceled(message)) => {
            let message = format!("job canceled during run: {message}");
            finish_canceled(store, runner_id, attempt_id, job.job_id, result, &message).await?;
            return Ok(JobStatus::Canceled);
        }
        Err(error) => {
            finish_error(
                store,
                runner_id,
                attempt_id,
                job.job_id,
                result,
                error.clone(),
            )
            .await?;
            return Ok(terminal_status_from_error(&error));
        }
    };

    result.absorb_run_output(run_output);
    let status = terminal_status_from_run_result(&result);
    let message = terminal_message_from_run_result(&result, status);
    store
        .finish(runner_id, attempt_id, job.job_id, status, result, &message)
        .await?;

    Ok(status)
}

fn cancellation_requested(cancel: &CancellationReceiver) -> bool {
    *cancel.borrow()
}

async fn finish_canceled<S>(
    store: &S,
    runner_id: &str,
    attempt_id: AttemptId,
    job_id: JobId,
    result: JobResult,
    message: &str,
) -> Result<(), RunnerError>
where
    S: JobStore + ?Sized,
{
    store
        .finish(
            runner_id,
            attempt_id,
            job_id,
            JobStatus::Canceled,
            result,
            message,
        )
        .await
}

async fn finish_error<S>(
    store: &S,
    runner_id: &str,
    attempt_id: AttemptId,
    job_id: JobId,
    result: JobResult,
    error: RunnerError,
) -> Result<(), RunnerError>
where
    S: JobStore + ?Sized,
{
    let status = terminal_status_from_error(&error);
    let message = error.to_string();
    store
        .finish(runner_id, attempt_id, job_id, status, result, &message)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

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
        assert_eq!(
            terminal_status_from_error(&RunnerError::Canceled("client".to_owned())),
            JobStatus::Canceled
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

        let cpu_signal = JobResult {
            signal: Some(libc::SIGXCPU),
            ..JobResult::default()
        };
        let file_signal = JobResult {
            signal: Some(libc::SIGXFSZ),
            ..JobResult::default()
        };
        let seccomp_signal = JobResult {
            signal: Some(libc::SIGSYS),
            ..JobResult::default()
        };

        assert_eq!(
            terminal_status_from_compile_result(&cpu_signal),
            Some(JobStatus::TimeLimitExceeded)
        );
        assert_eq!(
            terminal_status_from_compile_result(&file_signal),
            Some(JobStatus::OutputLimitExceeded)
        );
        assert_eq!(
            terminal_status_from_compile_result(&seccomp_signal),
            Some(JobStatus::CompileFailed)
        );
        assert_eq!(
            terminal_message_from_compile_result(&seccomp_signal, JobStatus::CompileFailed),
            "compile blocked by seccomp"
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
        let cpu_signal = JobResult {
            signal: Some(libc::SIGXCPU),
            ..JobResult::default()
        };
        let file_signal = JobResult {
            signal: Some(libc::SIGXFSZ),
            ..JobResult::default()
        };
        let seccomp_signal = JobResult {
            signal: Some(libc::SIGSYS),
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
            terminal_status_from_run_result(&cpu_signal),
            JobStatus::TimeLimitExceeded
        );
        assert_eq!(
            terminal_status_from_run_result(&file_signal),
            JobStatus::OutputLimitExceeded
        );
        assert_eq!(
            terminal_status_from_run_result(&seccomp_signal),
            JobStatus::RuntimeFailed
        );
        assert_eq!(
            terminal_message_from_run_result(&seccomp_signal, JobStatus::RuntimeFailed),
            "run blocked by seccomp"
        );
        assert_eq!(
            terminal_status_from_run_result(&truncated),
            JobStatus::OutputLimitExceeded
        );
    }

    #[test]
    fn terminal_reasons_are_stable() {
        let seccomp = JobResult {
            signal: Some(libc::SIGSYS),
            ..JobResult::default()
        };
        let truncated = JobResult {
            stdout_truncated: true,
            ..JobResult::default()
        };
        let oom = JobResult {
            memory_oom_kill_count: 1,
            ..JobResult::default()
        };
        let failed = JobResult {
            exit_code: Some(2),
            ..JobResult::default()
        };

        assert_eq!(
            terminal_reason_from_result(JobStatus::RuntimeFailed, &seccomp),
            "seccomp_sigsys"
        );
        assert_eq!(
            terminal_reason_from_result(JobStatus::OutputLimitExceeded, &truncated),
            "output_truncated"
        );
        assert_eq!(
            terminal_reason_from_result(JobStatus::MemoryLimitExceeded, &oom),
            "memory_cgroup_oom"
        );
        assert_eq!(
            terminal_reason_from_result(JobStatus::CompileFailed, &failed),
            "exit_code_2"
        );
        assert_eq!(
            terminal_reason_from_result(JobStatus::TimeLimitExceeded, &JobResult::default()),
            "timeout"
        );
    }

    #[tokio::test]
    async fn cancellation_after_validation_finishes_attempt() {
        let store = RecordingStore::default();
        let runtime = NeverRuntime;
        let sandbox = NeverSandbox;
        let job = test_job();
        let (_cancel_tx, mut cancel_rx) = tokio::sync::watch::channel(true);

        let status = execute_job(
            &store,
            "runner-a",
            &runtime,
            &sandbox,
            job.clone(),
            &mut cancel_rx,
        )
        .await
        .expect("canceled job should finish cleanly");

        assert_eq!(status, JobStatus::Canceled);
        let finishes = store.finishes.lock().expect("finishes");
        assert_eq!(finishes.len(), 1);
        assert_eq!(finishes[0].0, job.attempt_id);
        assert_eq!(finishes[0].1, JobStatus::Canceled);
        assert_eq!(finishes[0].2, "job canceled while validating");
        assert_eq!(finishes[0].3, "runner-a");
    }

    #[test]
    fn max_attempts_must_be_positive() {
        assert_eq!(
            positive_u32_value("LAEUFER_MAX_ATTEMPTS", "3".to_owned()),
            Ok(3)
        );
        assert!(matches!(
            positive_u32_value("LAEUFER_MAX_ATTEMPTS", "0".to_owned()),
            Err(ConfigError::InvalidPositiveInteger { .. })
        ));
        assert!(matches!(
            positive_u32_value("LAEUFER_MAX_ATTEMPTS", "abc".to_owned()),
            Err(ConfigError::InvalidInteger { .. })
        ));
    }

    #[derive(Default)]
    struct RecordingStore {
        finishes: Mutex<Vec<(AttemptId, JobStatus, String, String)>>,
    }

    #[async_trait::async_trait]
    impl JobStore for RecordingStore {
        async fn lease_next(
            &self,
            _runner_id: &str,
            _lease_ttl: Duration,
            _max_attempts: u32,
        ) -> Result<Option<Job>, RunnerError> {
            Ok(None)
        }

        async fn update_status(
            &self,
            _runner_id: &str,
            _attempt_id: AttemptId,
            _job_id: JobId,
            _status: JobStatus,
            _message: &str,
        ) -> Result<(), RunnerError> {
            Ok(())
        }

        async fn renew_lease(
            &self,
            _runner_id: &str,
            _attempt_id: AttemptId,
            _job_id: JobId,
            _lease_ttl: Duration,
        ) -> Result<(), RunnerError> {
            Ok(())
        }

        async fn current_status(&self, _job_id: JobId) -> Result<Option<JobStatus>, RunnerError> {
            Ok(None)
        }

        async fn finish(
            &self,
            runner_id: &str,
            attempt_id: AttemptId,
            _job_id: JobId,
            status: JobStatus,
            _result: JobResult,
            error_message: &str,
        ) -> Result<(), RunnerError> {
            self.finishes.lock().expect("finishes").push((
                attempt_id,
                status,
                error_message.to_owned(),
                runner_id.to_owned(),
            ));
            Ok(())
        }
    }

    struct NeverRuntime;

    #[async_trait::async_trait]
    impl LanguageRuntime for NeverRuntime {
        async fn prepare(&self, _job: &Job) -> Result<BuildPlan, RunnerError> {
            panic!("runtime should not be called after cancellation")
        }
    }

    struct NeverSandbox;

    #[async_trait::async_trait]
    impl Sandbox for NeverSandbox {
        async fn preflight(&self) -> Result<(), RunnerError> {
            Ok(())
        }

        async fn execute(
            &self,
            _plan: &CommandPlan,
            _cancel: &mut CancellationReceiver,
        ) -> Result<JobResult, RunnerError> {
            panic!("sandbox should not be called after cancellation")
        }
    }

    fn test_job() -> Job {
        Job {
            job_id: Uuid::new_v4(),
            attempt_id: Uuid::new_v4(),
            status: JobStatus::Validating,
            language: "python".to_owned(),
            runtime_version: "3.11".to_owned(),
            entrypoint: "main.py".to_owned(),
            args: Vec::new(),
            stdin: Bytes::new(),
            archive_targz: Bytes::from_static(b"archive"),
            limits: JobLimits {
                compile_timeout: Duration::from_secs(1),
                run_timeout: Duration::from_secs(1),
                memory_limit_bytes: 128 * 1024 * 1024,
                cpu_millis: 1000,
                max_output_bytes: 1024,
            },
            created_at: Utc::now(),
            started_at: None,
            finished_at: None,
        }
    }
}
