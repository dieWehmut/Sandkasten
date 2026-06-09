use async_trait::async_trait;
use bytes::Bytes;
use chrono::{DateTime, Utc};
use laeufer_core::{Job, JobId, JobLimits, JobResult, JobStatus, JobStore, RunnerError};
use serde_json::Value;
use sqlx::postgres::{PgPoolOptions, PgRow};
use sqlx::{PgPool, Row};
use std::time::Duration;
use thiserror::Error;

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
}

#[async_trait]
impl JobStore for PgJobStore {
    async fn lease_next(
        &self,
        runner_id: &str,
        lease_ttl: Duration,
    ) -> Result<Option<Job>, RunnerError> {
        let lease_ms = duration_millis_i64(lease_ttl);
        let mut tx = self.pool.begin().await.map_err(store_error)?;

        let row = sqlx::query(
            r#"
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
                   )
                ORDER BY created_at
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            UPDATE jobs AS j
            SET status = 'VALIDATING'::job_status,
                runner_id = $1,
                lease_expires_at = now() + ($2::bigint * interval '1 millisecond'),
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
                j.created_at,
                j.started_at,
                j.finished_at
            "#,
        )
        .bind(runner_id)
        .bind(lease_ms)
        .fetch_optional(&mut *tx)
        .await
        .map_err(store_error)?;

        let Some(row) = row else {
            tx.commit().await.map_err(store_error)?;
            return Ok(None);
        };

        let job = row_to_job(row)?;
        insert_event(&mut tx, job.job_id, JobStatus::Validating, "leased by runner").await?;
        tx.commit().await.map_err(store_error)?;
        Ok(Some(job))
    }

    async fn update_status(
        &self,
        job_id: JobId,
        status: JobStatus,
        message: &str,
    ) -> Result<(), RunnerError> {
        let mut tx = self.pool.begin().await.map_err(store_error)?;
        sqlx::query(
            r#"
            UPDATE jobs
            SET status = $2::job_status,
                started_at = COALESCE(started_at, now())
            WHERE job_id = $1
            "#,
        )
        .bind(job_id)
        .bind(status.as_db_str())
        .execute(&mut *tx)
        .await
        .map_err(store_error)?;

        insert_event(&mut tx, job_id, status, message).await?;
        tx.commit().await.map_err(store_error)?;
        Ok(())
    }

    async fn finish(
        &self,
        job_id: JobId,
        status: JobStatus,
        result: JobResult,
        error_message: &str,
    ) -> Result<(), RunnerError> {
        debug_assert!(status.is_terminal());

        let mut tx = self.pool.begin().await.map_err(store_error)?;
        sqlx::query(
            r#"
            UPDATE jobs
            SET status = $2::job_status,
                error_message = $3,
                lease_expires_at = NULL,
                finished_at = COALESCE(finished_at, now())
            WHERE job_id = $1
            "#,
        )
        .bind(job_id)
        .bind(status.as_db_str())
        .bind(error_message)
        .execute(&mut *tx)
        .await
        .map_err(store_error)?;

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
                stderr_truncated
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
                stderr_truncated = EXCLUDED.stderr_truncated
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
        .execute(&mut *tx)
        .await
        .map_err(store_error)?;

        insert_event(&mut tx, job_id, status, error_message).await?;
        tx.commit().await.map_err(store_error)?;
        Ok(())
    }
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
    Ok(())
}

fn row_to_job(row: PgRow) -> Result<Job, RunnerError> {
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
}
