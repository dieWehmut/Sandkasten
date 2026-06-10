use async_trait::async_trait;
use bytes::Bytes;
use chrono::{DateTime, Utc};
use laeufer_core::{
    terminal_reason_from_result, AttemptId, Job, JobId, JobLimits, JobResult, JobStatus, JobStore,
    RunnerError,
};
use serde_json::Value;
use sqlx::postgres::{PgListener, PgPoolOptions, PgRow};
use sqlx::{PgPool, Row};
use std::time::Duration;
use thiserror::Error;
use tokio::sync::watch;

const JOB_EVENTS_CHANNEL: &str = "sandkasten_job_events";
const JOB_QUEUE_CHANNEL: &str = "sandkasten_job_queue";

const DEAD_LETTER_EXPIRED_ATTEMPTS_SQL: &str = r#"
WITH expired AS (
    SELECT job_id
    FROM jobs
    WHERE status IN (
        'VALIDATING'::job_status,
        'COMPILING'::job_status,
        'RUNNING'::job_status
    )
      AND lease_expires_at < now()
      AND attempt_count >= $1
    FOR UPDATE SKIP LOCKED
),
dead AS (
    UPDATE jobs AS j
    SET status = 'SYSTEM_ERROR'::job_status,
        error_message = 'job exceeded maximum runner attempts',
        lease_expires_at = NULL,
        finished_at = COALESCE(j.finished_at, now())
    FROM expired
    WHERE j.job_id = expired.job_id
    RETURNING j.job_id
),
attempts AS (
    UPDATE job_attempts AS a
    SET status = 'SYSTEM_ERROR'::job_status,
        phase = 'DEAD_LETTER',
        error_message = 'job exceeded maximum runner attempts',
        terminal_reason = 'dead_letter',
        finished_at = COALESCE(a.finished_at, now())
    FROM dead
    WHERE a.job_id = dead.job_id
      AND a.attempt_number = (
          SELECT max(attempt_number)
          FROM job_attempts
          WHERE job_id = dead.job_id
      )
    RETURNING a.job_id
),
events AS (
    INSERT INTO job_events (job_id, status, message)
    SELECT job_id, 'SYSTEM_ERROR'::job_status, 'job exceeded maximum runner attempts'
    FROM dead
    RETURNING job_id
)
SELECT pg_notify('sandkasten_job_events', job_id::text)
FROM events
"#;

const LEASE_NEXT_SQL: &str = r#"
WITH candidate AS (
    SELECT job_id
    FROM jobs
    WHERE status = 'QUEUED'::job_status
       OR (
           status IN (
               'VALIDATING'::job_status,
               'COMPILING'::job_status,
               'RUNNING'::job_status
           )
           AND lease_expires_at < now()
           AND attempt_count < $3
       )
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
)
UPDATE jobs AS j
SET status = 'VALIDATING'::job_status,
    runner_id = $1,
    lease_expires_at = now() + ($2::bigint * interval '1 millisecond'),
    attempt_count = j.attempt_count + 1,
    started_at = COALESCE(j.started_at, now())
FROM candidate
WHERE j.job_id = candidate.job_id
RETURNING
    j.job_id,
    j.status::text AS status,
    j.language,
    j.runtime_version,
    j.entrypoint,
    j.args,
    j.stdin,
    j.archive_targz,
    j.compile_timeout_ms,
    j.run_timeout_ms,
    j.memory_limit_bytes,
    j.cpu_millis,
    j.max_output_bytes,
    j.attempt_count,
    j.created_at,
    j.started_at,
    j.finished_at
"#;

const UPDATE_STATUS_SQL: &str = r#"
UPDATE jobs AS j
SET status = $4::job_status,
    started_at = COALESCE(j.started_at, now())
WHERE j.job_id = $1
  AND j.runner_id = $2
  AND EXISTS (
      SELECT 1
      FROM job_attempts
      WHERE attempt_id = $3
        AND job_id = $1
        AND runner_id = $2
        AND attempt_number = j.attempt_count
        AND finished_at IS NULL
  )
  AND j.status IN (
      'VALIDATING'::job_status,
      'COMPILING'::job_status,
      'RUNNING'::job_status
  )
"#;

const FINISH_SQL: &str = r#"
UPDATE jobs AS j
SET status = $4::job_status,
    error_message = $5,
    lease_expires_at = NULL,
    finished_at = COALESCE(j.finished_at, now())
WHERE j.job_id = $1
  AND j.runner_id = $2
  AND EXISTS (
      SELECT 1
      FROM job_attempts
      WHERE attempt_id = $3
        AND job_id = $1
        AND runner_id = $2
        AND attempt_number = j.attempt_count
        AND finished_at IS NULL
  )
  AND (
      j.status IN (
          'VALIDATING'::job_status,
          'COMPILING'::job_status,
          'RUNNING'::job_status
      )
      OR (
          j.status = 'CANCELED'::job_status
          AND $4::job_status = 'CANCELED'::job_status
      )
  )
"#;

const INSERT_ATTEMPT_SQL: &str = r#"
INSERT INTO job_attempts (
    job_id,
    attempt_number,
    runner_id,
    status,
    phase
)
VALUES ($1, $2, $3, 'VALIDATING'::job_status, 'LEASED')
RETURNING attempt_id
"#;

const UPDATE_CURRENT_ATTEMPT_SQL: &str = r#"
UPDATE job_attempts
SET status = $4::job_status,
    phase = $5,
    error_message = CASE WHEN $6 = '' THEN error_message ELSE $6 END,
    finished_at = CASE WHEN $7 THEN COALESCE(finished_at, now()) ELSE finished_at END,
    terminal_reason = CASE WHEN $8 = '' THEN terminal_reason ELSE $8 END,
    exit_code = CASE WHEN $7 THEN $9 ELSE exit_code END,
    signal = CASE WHEN $7 THEN $10 ELSE signal END,
    wall_time_ms = CASE WHEN $7 THEN $11 ELSE wall_time_ms END,
    memory_peak_bytes = CASE WHEN $7 THEN $12 ELSE memory_peak_bytes END,
    stdout_truncated = CASE WHEN $7 THEN $13 ELSE stdout_truncated END,
    stderr_truncated = CASE WHEN $7 THEN $14 ELSE stderr_truncated END,
    cpu_usage_usec = CASE WHEN $7 THEN $15 ELSE cpu_usage_usec END,
    cpu_throttled_usec = CASE WHEN $7 THEN $16 ELSE cpu_throttled_usec END,
    pids_peak = CASE WHEN $7 THEN $17 ELSE pids_peak END,
    memory_oom_kill_count = CASE WHEN $7 THEN $18 ELSE memory_oom_kill_count END,
    cgroup_path = CASE WHEN $7 THEN $19 ELSE cgroup_path END,
    child_pid = CASE WHEN $7 THEN $20 ELSE child_pid END
WHERE attempt_id = $1
  AND job_id = $2
  AND runner_id = $3
"#;

#[derive(Clone, Debug)]
pub struct PgJobStore {
    pool: PgPool,
}

impl PgJobStore {
    pub async fn connect(database_url: &str) -> Result<Self, RunnerError> {
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(database_url)
            .await
            .map_err(store_error)?;
        Ok(Self { pool })
    }

    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    pub async fn subscribe_job_queue(&self) -> Result<watch::Receiver<u64>, RunnerError> {
        self.subscribe_notifications(JOB_QUEUE_CHANNEL, None).await
    }

    pub async fn subscribe_job_events(
        &self,
        job_id: JobId,
    ) -> Result<watch::Receiver<u64>, RunnerError> {
        self.subscribe_notifications(JOB_EVENTS_CHANNEL, Some(job_id.to_string()))
            .await
    }

    async fn subscribe_notifications(
        &self,
        channel: &'static str,
        payload_filter: Option<String>,
    ) -> Result<watch::Receiver<u64>, RunnerError> {
        let mut listener = PgListener::connect_with(&self.pool)
            .await
            .map_err(store_error)?;
        listener.listen(channel).await.map_err(store_error)?;

        let (tx, rx) = watch::channel(0_u64);
        tokio::spawn(async move {
            let mut version = 0_u64;
            loop {
                tokio::select! {
                    _ = tx.closed() => break,
                    notification = listener.recv() => {
                        match notification {
                            Ok(notification)
                                if notification.channel() == channel
                                    && payload_filter
                                        .as_deref()
                                        .is_none_or(|payload| notification.payload() == payload) =>
                            {
                                version = version.saturating_add(1);
                                if tx.send(version).is_err() {
                                    break;
                                }
                            }
                            Ok(_) => {}
                            Err(error) => {
                                eprintln!("postgres notification listener stopped for {channel}: {error}");
                                break;
                            }
                        }
                    }
                }
            }
        });

        Ok(rx)
    }
}

#[async_trait]
impl JobStore for PgJobStore {
    async fn lease_next(
        &self,
        runner_id: &str,
        lease_ttl: Duration,
        max_attempts: u32,
    ) -> Result<Option<Job>, RunnerError> {
        let lease_ms = duration_millis_i64(lease_ttl);
        let max_attempts = i32::try_from(max_attempts).unwrap_or(i32::MAX);
        let mut tx = self.pool.begin().await.map_err(store_error)?;

        sqlx::query(DEAD_LETTER_EXPIRED_ATTEMPTS_SQL)
            .bind(max_attempts)
            .execute(&mut *tx)
            .await
            .map_err(store_error)?;

        let row = sqlx::query(LEASE_NEXT_SQL)
            .bind(runner_id)
            .bind(lease_ms)
            .bind(max_attempts)
            .fetch_optional(&mut *tx)
            .await
            .map_err(store_error)?;

        let Some(row) = row else {
            tx.commit().await.map_err(store_error)?;
            return Ok(None);
        };

        let job_id: JobId = row.try_get("job_id").map_err(store_error)?;
        let attempt_number: i32 = row.try_get("attempt_count").map_err(store_error)?;
        let attempt_id = insert_attempt(&mut tx, job_id, attempt_number, runner_id).await?;
        let job = row_to_job(row, attempt_id)?;
        insert_event(
            &mut tx,
            job.job_id,
            JobStatus::Validating,
            "leased by runner",
        )
        .await?;
        tx.commit().await.map_err(store_error)?;
        Ok(Some(job))
    }

    async fn update_status(
        &self,
        runner_id: &str,
        attempt_id: AttemptId,
        job_id: JobId,
        status: JobStatus,
        message: &str,
    ) -> Result<(), RunnerError> {
        let mut tx = self.pool.begin().await.map_err(store_error)?;
        let result = sqlx::query(UPDATE_STATUS_SQL)
            .bind(job_id)
            .bind(runner_id)
            .bind(attempt_id)
            .bind(status.as_db_str())
            .execute(&mut *tx)
            .await
            .map_err(store_error)?;
        if result.rows_affected() == 0 {
            return Err(StoreError::StaleLease {
                job_id,
                runner_id: runner_id.to_owned(),
            }
            .into());
        }

        insert_event(&mut tx, job_id, status, message).await?;
        update_current_attempt(
            &mut tx,
            AttemptUpdate {
                attempt_id,
                job_id,
                runner_id,
                status,
                phase: status.as_db_str(),
                error_message: message,
                terminal_reason: "",
                result: None,
                finished: false,
            },
        )
        .await?;
        tx.commit().await.map_err(store_error)?;
        Ok(())
    }

    async fn renew_lease(
        &self,
        runner_id: &str,
        attempt_id: AttemptId,
        job_id: JobId,
        lease_ttl: Duration,
    ) -> Result<(), RunnerError> {
        let lease_ms = duration_millis_i64(lease_ttl);
        let result = sqlx::query(
            r#"
            UPDATE jobs AS j
            SET lease_expires_at = now() + ($4::bigint * interval '1 millisecond')
            WHERE j.job_id = $1
              AND j.runner_id = $2
              AND EXISTS (
                  SELECT 1
                  FROM job_attempts
                  WHERE attempt_id = $3
                    AND job_id = $1
                    AND runner_id = $2
                    AND attempt_number = j.attempt_count
                    AND finished_at IS NULL
              )
              AND j.status IN (
                  'VALIDATING'::job_status,
                  'COMPILING'::job_status,
                  'RUNNING'::job_status
              )
            "#,
        )
        .bind(job_id)
        .bind(runner_id)
        .bind(attempt_id)
        .bind(lease_ms)
        .execute(&self.pool)
        .await
        .map_err(store_error)?;
        if result.rows_affected() == 0 {
            return Err(StoreError::StaleLease {
                job_id,
                runner_id: runner_id.to_owned(),
            }
            .into());
        }
        Ok(())
    }

    async fn current_status(&self, job_id: JobId) -> Result<Option<JobStatus>, RunnerError> {
        let status_text: Option<String> = sqlx::query_scalar(
            r#"
            SELECT status::text
            FROM jobs
            WHERE job_id = $1
            "#,
        )
        .bind(job_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(store_error)?;

        status_text
            .map(JobStatus::try_from)
            .transpose()
            .map_err(StoreError::Status)
            .map_err(Into::into)
    }

    async fn finish(
        &self,
        runner_id: &str,
        attempt_id: AttemptId,
        job_id: JobId,
        status: JobStatus,
        result: JobResult,
        error_message: &str,
    ) -> Result<(), RunnerError> {
        debug_assert!(status.is_terminal());

        let mut tx = self.pool.begin().await.map_err(store_error)?;
        let update = sqlx::query(FINISH_SQL)
            .bind(job_id)
            .bind(runner_id)
            .bind(attempt_id)
            .bind(status.as_db_str())
            .bind(error_message)
            .execute(&mut *tx)
            .await
            .map_err(store_error)?;
        if update.rows_affected() == 0 {
            return Err(StoreError::StaleLease {
                job_id,
                runner_id: runner_id.to_owned(),
            }
            .into());
        }

        sqlx::query(
            r#"
            INSERT INTO job_artifacts (
                job_id,
                stdout,
                stderr,
                compile_stdout,
                compile_stderr,
                exit_code,
                signal,
                wall_time_ms,
                memory_peak_bytes,
                stdout_truncated,
                stderr_truncated,
                cpu_usage_usec,
                cpu_throttled_usec,
                pids_peak,
                memory_oom_kill_count
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            ON CONFLICT (job_id) DO UPDATE SET
                stdout = EXCLUDED.stdout,
                stderr = EXCLUDED.stderr,
                compile_stdout = EXCLUDED.compile_stdout,
                compile_stderr = EXCLUDED.compile_stderr,
                exit_code = EXCLUDED.exit_code,
                signal = EXCLUDED.signal,
                wall_time_ms = EXCLUDED.wall_time_ms,
                memory_peak_bytes = EXCLUDED.memory_peak_bytes,
                stdout_truncated = EXCLUDED.stdout_truncated,
                stderr_truncated = EXCLUDED.stderr_truncated,
                cpu_usage_usec = EXCLUDED.cpu_usage_usec,
                cpu_throttled_usec = EXCLUDED.cpu_throttled_usec,
                pids_peak = EXCLUDED.pids_peak,
                memory_oom_kill_count = EXCLUDED.memory_oom_kill_count
            "#,
        )
        .bind(job_id)
        .bind(result.stdout.to_vec())
        .bind(result.stderr.to_vec())
        .bind(result.compile_stdout.to_vec())
        .bind(result.compile_stderr.to_vec())
        .bind(result.exit_code)
        .bind(result.signal)
        .bind(duration_millis_i64(result.wall_time))
        .bind(u64_to_i64(result.memory_peak_bytes, "memory_peak_bytes")?)
        .bind(result.stdout_truncated)
        .bind(result.stderr_truncated)
        .bind(u64_to_i64(result.cpu_usage_usec, "cpu_usage_usec")?)
        .bind(u64_to_i64(result.cpu_throttled_usec, "cpu_throttled_usec")?)
        .bind(u64_to_i64(result.pids_peak, "pids_peak")?)
        .bind(u64_to_i64(
            result.memory_oom_kill_count,
            "memory_oom_kill_count",
        )?)
        .execute(&mut *tx)
        .await
        .map_err(store_error)?;

        insert_event(&mut tx, job_id, status, error_message).await?;
        let terminal_reason = terminal_reason_from_result(status, &result);
        update_current_attempt(
            &mut tx,
            AttemptUpdate {
                attempt_id,
                job_id,
                runner_id,
                status,
                phase: "FINISHED",
                error_message,
                terminal_reason: &terminal_reason,
                result: Some(&result),
                finished: true,
            },
        )
        .await?;
        tx.commit().await.map_err(store_error)?;
        Ok(())
    }
}

async fn insert_attempt(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    job_id: JobId,
    attempt_number: i32,
    runner_id: &str,
) -> Result<AttemptId, RunnerError> {
    sqlx::query_scalar(INSERT_ATTEMPT_SQL)
        .bind(job_id)
        .bind(attempt_number)
        .bind(runner_id)
        .fetch_one(&mut **tx)
        .await
        .map_err(store_error)
}

async fn update_current_attempt(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    update: AttemptUpdate<'_>,
) -> Result<(), RunnerError> {
    let empty_result = JobResult::default();
    let attempt_result = update.result.unwrap_or(&empty_result);
    let update_result = sqlx::query(UPDATE_CURRENT_ATTEMPT_SQL)
        .bind(update.attempt_id)
        .bind(update.job_id)
        .bind(update.runner_id)
        .bind(update.status.as_db_str())
        .bind(update.phase)
        .bind(update.error_message)
        .bind(update.finished)
        .bind(update.terminal_reason)
        .bind(attempt_result.exit_code)
        .bind(attempt_result.signal)
        .bind(duration_millis_i64(attempt_result.wall_time))
        .bind(u64_to_i64(
            attempt_result.memory_peak_bytes,
            "attempt_memory_peak_bytes",
        )?)
        .bind(attempt_result.stdout_truncated)
        .bind(attempt_result.stderr_truncated)
        .bind(u64_to_i64(
            attempt_result.cpu_usage_usec,
            "attempt_cpu_usage_usec",
        )?)
        .bind(u64_to_i64(
            attempt_result.cpu_throttled_usec,
            "attempt_cpu_throttled_usec",
        )?)
        .bind(u64_to_i64(attempt_result.pids_peak, "attempt_pids_peak")?)
        .bind(u64_to_i64(
            attempt_result.memory_oom_kill_count,
            "attempt_memory_oom_kill_count",
        )?)
        .bind(attempt_result.cgroup_path.as_deref().unwrap_or(""))
        .bind(optional_u32_to_i32(
            attempt_result.child_pid,
            "attempt_child_pid",
        )?)
        .execute(&mut **tx)
        .await
        .map_err(store_error)?;
    if update_result.rows_affected() == 0 {
        return Err(StoreError::MissingAttempt {
            job_id: update.job_id,
            runner_id: update.runner_id.to_owned(),
        }
        .into());
    }
    Ok(())
}

struct AttemptUpdate<'a> {
    attempt_id: AttemptId,
    job_id: JobId,
    runner_id: &'a str,
    status: JobStatus,
    phase: &'a str,
    error_message: &'a str,
    terminal_reason: &'a str,
    result: Option<&'a JobResult>,
    finished: bool,
}

async fn insert_event(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    job_id: JobId,
    status: JobStatus,
    message: &str,
) -> Result<(), RunnerError> {
    sqlx::query(
        r#"
        INSERT INTO job_events (job_id, status, message)
        VALUES ($1, $2::job_status, $3)
        "#,
    )
    .bind(job_id)
    .bind(status.as_db_str())
    .bind(message)
    .execute(&mut **tx)
    .await
    .map_err(store_error)?;
    notify(tx, JOB_EVENTS_CHANNEL, &job_id.to_string()).await?;
    Ok(())
}

async fn notify(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    channel: &str,
    payload: &str,
) -> Result<(), RunnerError> {
    sqlx::query("SELECT pg_notify($1, $2)")
        .bind(channel)
        .bind(payload)
        .execute(&mut **tx)
        .await
        .map_err(store_error)?;
    Ok(())
}

fn row_to_job(row: PgRow, attempt_id: AttemptId) -> Result<Job, RunnerError> {
    let status_text: String = row.try_get("status").map_err(store_error)?;
    let status = JobStatus::try_from(status_text).map_err(StoreError::Status)?;
    let args_value: Value = row.try_get("args").map_err(store_error)?;
    let args: Vec<String> = serde_json::from_value(args_value).map_err(StoreError::Json)?;

    let compile_timeout_ms: i32 = row.try_get("compile_timeout_ms").map_err(store_error)?;
    let run_timeout_ms: i32 = row.try_get("run_timeout_ms").map_err(store_error)?;
    let memory_limit_bytes: i64 = row.try_get("memory_limit_bytes").map_err(store_error)?;
    let cpu_millis: i32 = row.try_get("cpu_millis").map_err(store_error)?;
    let max_output_bytes: i64 = row.try_get("max_output_bytes").map_err(store_error)?;
    let stdin: Vec<u8> = row.try_get("stdin").map_err(store_error)?;
    let archive_targz: Vec<u8> = row.try_get("archive_targz").map_err(store_error)?;

    Ok(Job {
        job_id: row.try_get("job_id").map_err(store_error)?,
        attempt_id,
        status,
        language: row.try_get("language").map_err(store_error)?,
        runtime_version: row.try_get("runtime_version").map_err(store_error)?,
        entrypoint: row.try_get("entrypoint").map_err(store_error)?,
        args,
        stdin: Bytes::from(stdin),
        archive_targz: Bytes::from(archive_targz),
        limits: JobLimits {
            compile_timeout: Duration::from_millis(nonnegative_i32_to_u64(
                compile_timeout_ms,
                "compile_timeout_ms",
            )?),
            run_timeout: Duration::from_millis(nonnegative_i32_to_u64(
                run_timeout_ms,
                "run_timeout_ms",
            )?),
            memory_limit_bytes: nonnegative_i64_to_u64(memory_limit_bytes, "memory_limit_bytes")?,
            cpu_millis: nonnegative_i32_to_u64(cpu_millis, "cpu_millis")? as u32,
            max_output_bytes: nonnegative_i64_to_u64(max_output_bytes, "max_output_bytes")?,
        },
        created_at: row
            .try_get::<DateTime<Utc>, _>("created_at")
            .map_err(store_error)?,
        started_at: row
            .try_get::<Option<DateTime<Utc>>, _>("started_at")
            .map_err(store_error)?,
        finished_at: row
            .try_get::<Option<DateTime<Utc>>, _>("finished_at")
            .map_err(store_error)?,
    })
}

fn duration_millis_i64(duration: Duration) -> i64 {
    i64::try_from(duration.as_millis()).unwrap_or(i64::MAX)
}

fn nonnegative_i32_to_u64(value: i32, field: &'static str) -> Result<u64, RunnerError> {
    if value < 0 {
        Err(StoreError::NegativeField { field }.into())
    } else {
        Ok(value as u64)
    }
}

fn nonnegative_i64_to_u64(value: i64, field: &'static str) -> Result<u64, RunnerError> {
    if value < 0 {
        Err(StoreError::NegativeField { field }.into())
    } else {
        Ok(value as u64)
    }
}

fn u64_to_i64(value: u64, field: &'static str) -> Result<i64, RunnerError> {
    i64::try_from(value).map_err(|_| StoreError::OverflowField { field }.into())
}

fn optional_u32_to_i32(
    value: Option<u32>,
    field: &'static str,
) -> Result<Option<i32>, RunnerError> {
    value
        .map(|value| i32::try_from(value).map_err(|_| StoreError::OverflowField { field }.into()))
        .transpose()
}

fn store_error(error: sqlx::Error) -> RunnerError {
    StoreError::Sqlx(error).into()
}

#[derive(Debug, Error)]
enum StoreError {
    #[error("database error: {0}")]
    Sqlx(#[from] sqlx::Error),
    #[error("invalid status from database: {0}")]
    Status(#[from] laeufer_core::StatusParseError),
    #[error("invalid args json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("database field {field} must not be negative")]
    NegativeField { field: &'static str },
    #[error("database field {field} does not fit in BIGINT")]
    OverflowField { field: &'static str },
    #[error("runner {runner_id:?} no longer holds lease for job {job_id}")]
    StaleLease { job_id: JobId, runner_id: String },
    #[error("runner {runner_id:?} has no recorded attempt for job {job_id}")]
    MissingAttempt { job_id: JobId, runner_id: String },
}

impl From<StoreError> for RunnerError {
    fn from(error: StoreError) -> Self {
        RunnerError::Store(error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duration_millis_saturates_to_i64() {
        assert_eq!(duration_millis_i64(Duration::from_millis(42)), 42);
        assert_eq!(duration_millis_i64(Duration::MAX), i64::MAX);
    }

    #[test]
    fn rejects_negative_database_limits() {
        assert!(nonnegative_i64_to_u64(-1, "memory_limit_bytes").is_err());
        assert!(nonnegative_i32_to_u64(-1, "compile_timeout_ms").is_err());
    }

    #[test]
    fn stale_lease_maps_to_store_error() {
        let job_id = uuid::Uuid::nil();
        let error: RunnerError = StoreError::StaleLease {
            job_id,
            runner_id: "runner-a".to_owned(),
        }
        .into();
        assert!(
            matches!(error, RunnerError::Store(message) if message.contains("runner-a") && message.contains(&job_id.to_string()))
        );
    }

    #[test]
    fn missing_attempt_maps_to_store_error() {
        let job_id = uuid::Uuid::nil();
        let error: RunnerError = StoreError::MissingAttempt {
            job_id,
            runner_id: "runner-a".to_owned(),
        }
        .into();
        assert!(
            matches!(error, RunnerError::Store(message) if message.contains("no recorded attempt") && message.contains(&job_id.to_string()))
        );
    }

    #[test]
    fn lease_sql_enforces_attempt_dead_letter() {
        assert!(LEASE_NEXT_SQL.contains("attempt_count = j.attempt_count + 1"));
        assert!(LEASE_NEXT_SQL.contains("attempt_count < $3"));
        assert!(LEASE_NEXT_SQL.contains("j.attempt_count"));
        assert!(DEAD_LETTER_EXPIRED_ATTEMPTS_SQL.contains("attempt_count >= $1"));
        assert!(DEAD_LETTER_EXPIRED_ATTEMPTS_SQL.contains("SYSTEM_ERROR"));
        assert!(DEAD_LETTER_EXPIRED_ATTEMPTS_SQL.contains("job_attempts"));
        assert!(DEAD_LETTER_EXPIRED_ATTEMPTS_SQL.contains("DEAD_LETTER"));
        assert!(DEAD_LETTER_EXPIRED_ATTEMPTS_SQL.contains("terminal_reason = 'dead_letter'"));
        assert!(DEAD_LETTER_EXPIRED_ATTEMPTS_SQL.contains("job_events"));
        assert!(DEAD_LETTER_EXPIRED_ATTEMPTS_SQL.contains("sandkasten_job_events"));
        assert!(INSERT_ATTEMPT_SQL.contains("job_attempts"));
        assert!(INSERT_ATTEMPT_SQL.contains("attempt_number"));
        assert!(INSERT_ATTEMPT_SQL.contains("'LEASED'"));
        assert!(UPDATE_CURRENT_ATTEMPT_SQL.contains("WHERE attempt_id = $1"));
        assert!(UPDATE_CURRENT_ATTEMPT_SQL.contains("finished_at"));
    }

    #[test]
    fn guarded_writes_only_update_active_jobs() {
        assert!(UPDATE_STATUS_SQL.contains("attempt_id = $3"));
        assert!(UPDATE_STATUS_SQL.contains("runner_id = $2"));
        assert!(UPDATE_STATUS_SQL.contains("attempt_number = j.attempt_count"));
        assert!(UPDATE_STATUS_SQL.contains("'VALIDATING'::job_status"));
        assert!(UPDATE_STATUS_SQL.contains("'COMPILING'::job_status"));
        assert!(UPDATE_STATUS_SQL.contains("'RUNNING'::job_status"));
        assert!(FINISH_SQL.contains("attempt_id = $3"));
        assert!(FINISH_SQL.contains("runner_id = $2"));
        assert!(FINISH_SQL.contains("attempt_number = j.attempt_count"));
        assert!(FINISH_SQL.contains("'VALIDATING'::job_status"));
        assert!(FINISH_SQL.contains("'COMPILING'::job_status"));
        assert!(FINISH_SQL.contains("'RUNNING'::job_status"));
        assert!(FINISH_SQL.contains("j.status = 'CANCELED'::job_status"));
        assert!(FINISH_SQL.contains("$4::job_status = 'CANCELED'::job_status"));
    }

    #[test]
    fn attempt_update_sql_persists_terminal_diagnostics() {
        assert!(UPDATE_CURRENT_ATTEMPT_SQL.contains("terminal_reason"));
        assert!(UPDATE_CURRENT_ATTEMPT_SQL.contains("cgroup_path"));
        assert!(UPDATE_CURRENT_ATTEMPT_SQL.contains("child_pid"));
        assert!(UPDATE_CURRENT_ATTEMPT_SQL.contains("exit_code"));
        assert!(UPDATE_CURRENT_ATTEMPT_SQL.contains("signal"));
        assert!(UPDATE_CURRENT_ATTEMPT_SQL.contains("wall_time_ms"));
        assert!(UPDATE_CURRENT_ATTEMPT_SQL.contains("memory_peak_bytes"));
        assert!(UPDATE_CURRENT_ATTEMPT_SQL.contains("stdout_truncated"));
        assert!(UPDATE_CURRENT_ATTEMPT_SQL.contains("stderr_truncated"));
        assert!(UPDATE_CURRENT_ATTEMPT_SQL.contains("cpu_usage_usec"));
        assert!(UPDATE_CURRENT_ATTEMPT_SQL.contains("cpu_throttled_usec"));
        assert!(UPDATE_CURRENT_ATTEMPT_SQL.contains("pids_peak"));
        assert!(UPDATE_CURRENT_ATTEMPT_SQL.contains("memory_oom_kill_count"));
    }

    #[test]
    fn notification_channels_are_stable() {
        assert_eq!(JOB_EVENTS_CHANNEL, "sandkasten_job_events");
        assert_eq!(JOB_QUEUE_CHANNEL, "sandkasten_job_queue");
    }
}
