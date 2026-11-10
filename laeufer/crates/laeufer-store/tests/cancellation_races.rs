use bytes::Bytes;
use laeufer_core::{Job, JobResult, JobStatus, JobStore, RunnerError};
use laeufer_store::PgJobStore;
use sqlx::postgres::PgPoolOptions;
use sqlx::{PgPool, Row};
use std::time::Duration;
use uuid::Uuid;

#[tokio::test]
#[ignore = "requires LAEUFER_STORE_TEST_DATABASE_URL for an isolated development Postgres database"]
async fn cancellation_wins_finish_races_without_allowing_stale_attempt_writes() {
    let harness = Harness::new().await;
    cancellation_commit_while_finish_waits_preserves_artifact(&harness).await;
    stale_attempts_cannot_finalize_canceled_jobs(&harness).await;
    concurrent_finishes_cannot_publish_twice(&harness).await;
    completed_attempt_cannot_overwrite_artifact(&harness).await;
    harness.close().await;
}

async fn cancellation_commit_while_finish_waits_preserves_artifact(harness: &Harness) {
    let job = harness.lease_job("runner-current").await;
    harness
        .store
        .update_status(
            "runner-current",
            job.attempt_id,
            job.job_id,
            JobStatus::Running,
            "running",
        )
        .await
        .expect("running transition");
    let result = output();
    let mut cancellation = harness
        .store
        .pool()
        .begin()
        .await
        .expect("cancel transaction");
    sqlx::query("UPDATE jobs SET status = 'CANCELED', lease_expires_at = NULL, finished_at = now() WHERE job_id = $1")
        .bind(job.job_id).execute(&mut *cancellation).await.expect("API cancellation takes row lock");
    let store = harness.store.clone();
    let artifact = result.clone();
    let mut finish = tokio::spawn(async move {
        store
            .finish(
                "runner-current",
                job.attempt_id,
                job.job_id,
                JobStatus::Succeeded,
                artifact,
                "job finished successfully",
            )
            .await
    });
    assert!(
        tokio::time::timeout(Duration::from_millis(50), &mut finish)
            .await
            .is_err(),
        "finish must wait for the API cancellation transaction"
    );
    cancellation
        .commit()
        .await
        .expect("API cancellation commits");
    let status = tokio::time::timeout(Duration::from_secs(3), finish)
        .await
        .expect("finish resumes")
        .expect("finish task joins")
        .expect("current attempt can finish a canceled job");
    assert_eq!(status, JobStatus::Canceled);

    let row = sqlx::query(
        "SELECT j.status::text AS job_status, j.error_message AS job_message, \
         a.status::text AS attempt_status, a.phase, a.terminal_reason, a.finished_at IS NOT NULL AS attempt_finished, \
         a.wall_time_ms, a.cpu_usage_usec, a.cpu_throttled_usec, a.memory_peak_bytes, a.pids_peak, a.cgroup_path, a.child_pid, \
         r.stdout, r.stderr, r.compile_stdout, r.compile_stderr, r.exit_code, r.signal, \
         r.wall_time_ms AS artifact_wall_time_ms, r.cpu_usage_usec AS artifact_cpu_usage_usec, \
         r.cpu_throttled_usec AS artifact_cpu_throttled_usec, r.memory_peak_bytes AS artifact_memory_peak_bytes, \
         r.pids_peak AS artifact_pids_peak \
         FROM jobs j JOIN job_attempts a USING (job_id) JOIN job_artifacts r USING (job_id) WHERE j.job_id = $1"
    ).bind(job.job_id).fetch_one(harness.store.pool()).await.expect("finished artifact and attempt exist");
    assert_eq!(row.get::<String, _>("job_status"), "CANCELED");
    assert_eq!(row.get::<String, _>("attempt_status"), "CANCELED");
    assert_eq!(row.get::<String, _>("phase"), "FINISHED");
    assert_eq!(row.get::<String, _>("terminal_reason"), "canceled");
    assert!(row.get::<bool, _>("attempt_finished"));
    assert_eq!(row.get::<Vec<u8>, _>("stdout"), result.stdout);
    assert_eq!(row.get::<Vec<u8>, _>("stderr"), result.stderr);
    assert_eq!(
        row.get::<Vec<u8>, _>("compile_stdout"),
        result.compile_stdout
    );
    assert_eq!(
        row.get::<Vec<u8>, _>("compile_stderr"),
        result.compile_stderr
    );
    assert_eq!(row.get::<Option<i32>, _>("exit_code"), result.exit_code);
    assert_eq!(row.get::<Option<i32>, _>("signal"), result.signal);
    for (column, expected) in [
        ("wall_time_ms", 40),
        ("artifact_wall_time_ms", 40),
        ("cpu_usage_usec", 200),
        ("artifact_cpu_usage_usec", 200),
        ("cpu_throttled_usec", 10),
        ("artifact_cpu_throttled_usec", 10),
        ("memory_peak_bytes", 4096),
        ("artifact_memory_peak_bytes", 4096),
        ("pids_peak", 2),
        ("artifact_pids_peak", 2),
    ] {
        assert_eq!(row.get::<i64, _>(column), expected, "{column}");
    }
    assert_eq!(
        row.get::<String, _>("cgroup_path"),
        result.cgroup_path.expect("cgroup")
    );
    assert_eq!(row.get::<Option<i32>, _>("child_pid"), Some(123));
    let event = sqlx::query("SELECT status::text, message FROM job_events WHERE job_id = $1 ORDER BY sequence DESC LIMIT 1")
        .bind(job.job_id).fetch_one(harness.store.pool()).await.expect("final event");
    assert_eq!(event.get::<String, _>("status"), "CANCELED");
    assert_eq!(
        event.get::<String, _>("message"),
        row.get::<String, _>("job_message")
    );
    assert!(event.get::<String, _>("message").contains("canceled"));
}

async fn stale_attempts_cannot_finalize_canceled_jobs(harness: &Harness) {
    let old = harness.lease_job("runner-old").await;
    sqlx::query("UPDATE jobs SET lease_expires_at = now() - interval '1 second' WHERE job_id = $1")
        .bind(old.job_id)
        .execute(harness.store.pool())
        .await
        .expect("expire old lease");
    let current = harness
        .store
        .lease_next("runner-current", Duration::from_secs(30), 3)
        .await
        .expect("new lease")
        .expect("retry gets current attempt");
    assert_eq!(current.job_id, old.job_id);
    assert_ne!(current.attempt_id, old.attempt_id);
    sqlx::query("UPDATE jobs SET status = 'CANCELED', lease_expires_at = NULL WHERE job_id = $1")
        .bind(current.job_id)
        .execute(harness.store.pool())
        .await
        .expect("cancel retried job");
    let event_count: i64 = sqlx::query_scalar("SELECT count(*) FROM job_events WHERE job_id = $1")
        .bind(current.job_id)
        .fetch_one(harness.store.pool())
        .await
        .expect("event count before stale writes");
    for (runner, attempt) in [
        ("runner-old", old.attempt_id),
        ("runner-current", old.attempt_id),
        ("runner-old", current.attempt_id),
        ("runner-current", Uuid::new_v4()),
    ] {
        let error = harness
            .store
            .finish(
                runner,
                attempt,
                current.job_id,
                JobStatus::Succeeded,
                output(),
                "stale output",
            )
            .await
            .expect_err("cancellation cannot relax runner/attempt ownership");
        assert!(
            matches!(error, RunnerError::Store(message) if message.contains("no longer holds lease"))
        );
    }
    let artifacts: i64 = sqlx::query_scalar("SELECT count(*) FROM job_artifacts WHERE job_id = $1")
        .bind(current.job_id)
        .fetch_one(harness.store.pool())
        .await
        .expect("artifact count");
    assert_eq!(artifacts, 0);
    let remaining_events: i64 =
        sqlx::query_scalar("SELECT count(*) FROM job_events WHERE job_id = $1")
            .bind(current.job_id)
            .fetch_one(harness.store.pool())
            .await
            .expect("event count after stale writes");
    assert_eq!(remaining_events, event_count);
    let finished: bool = sqlx::query_scalar(
        "SELECT finished_at IS NOT NULL FROM job_attempts WHERE attempt_id = $1",
    )
    .bind(current.attempt_id)
    .fetch_one(harness.store.pool())
    .await
    .expect("attempt still active");
    assert!(!finished);
    let status = harness
        .store
        .finish(
            "runner-current",
            current.attempt_id,
            current.job_id,
            JobStatus::RuntimeFailed,
            output(),
            "natural run failed",
        )
        .await
        .expect("only current runner can publish canceled output");
    assert_eq!(status, JobStatus::Canceled);
}

async fn completed_attempt_cannot_overwrite_artifact(harness: &Harness) {
    let job = harness.lease_job("runner-current").await;
    let result = output();
    let status = harness
        .store
        .finish(
            "runner-current",
            job.attempt_id,
            job.job_id,
            JobStatus::Succeeded,
            result.clone(),
            "success",
        )
        .await
        .expect("uncanceled completion");
    assert_eq!(status, JobStatus::Succeeded);
    let error = harness
        .store
        .finish(
            "runner-current",
            job.attempt_id,
            job.job_id,
            JobStatus::Canceled,
            JobResult::default(),
            "late cancel",
        )
        .await
        .expect_err("already completed attempt cannot write again");
    assert!(matches!(error, RunnerError::Store(_)));
    let stdout: Vec<u8> = sqlx::query_scalar("SELECT stdout FROM job_artifacts WHERE job_id = $1")
        .bind(job.job_id)
        .fetch_one(harness.store.pool())
        .await
        .expect("original artifact");
    assert_eq!(stdout, result.stdout);
    assert_eq!(
        harness
            .store
            .current_status(job.job_id)
            .await
            .expect("status"),
        Some(JobStatus::Succeeded)
    );
}

async fn concurrent_finishes_cannot_publish_twice(harness: &Harness) {
    let job = harness.lease_job("runner-current").await;
    let mut blocker = harness.store.pool().begin().await.expect("hold job lock");
    sqlx::query("UPDATE jobs SET status = 'CANCELED' WHERE job_id = $1")
        .bind(job.job_id)
        .execute(&mut *blocker)
        .await
        .expect("cancel and lock job");
    let mut tasks = Vec::new();
    for _ in 0..2 {
        let store = harness.store.clone();
        tasks.push(tokio::spawn(async move {
            store
                .finish(
                    "runner-current",
                    job.attempt_id,
                    job.job_id,
                    JobStatus::Succeeded,
                    output(),
                    "concurrent result",
                )
                .await
        }));
    }
    for task in &mut tasks {
        assert!(
            tokio::time::timeout(Duration::from_millis(50), task)
                .await
                .is_err(),
            "both finish calls wait for cancellation"
        );
    }
    blocker.commit().await.expect("release cancellation lock");
    let mut published = 0;
    let mut refused = 0;
    for task in tasks {
        match tokio::time::timeout(Duration::from_secs(3), task)
            .await
            .expect("finish returns")
            .expect("task joins")
        {
            Ok(JobStatus::Canceled) => published += 1,
            Err(RunnerError::Store(_)) => refused += 1,
            outcome => panic!("unexpected completion: {outcome:?}"),
        }
    }
    assert_eq!(
        published, 1,
        "a finished attempt cannot publish another result concurrently"
    );
    assert_eq!(refused, 1);
    let events: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM job_events WHERE job_id = $1 AND status = 'CANCELED'",
    )
    .bind(job.job_id)
    .fetch_one(harness.store.pool())
    .await
    .expect("terminal event count");
    assert_eq!(events, 1);
}

fn output() -> JobResult {
    JobResult {
        stdout: Bytes::from_static(b"stdout before stop"),
        stderr: Bytes::from_static(b"stderr before stop"),
        compile_stdout: Bytes::from_static(b"compile stdout"),
        compile_stderr: Bytes::from_static(b"compile stderr"),
        exit_code: Some(0),
        wall_time: Duration::from_millis(40),
        memory_peak_bytes: 4096,
        cpu_usage_usec: 200,
        cpu_throttled_usec: 10,
        pids_peak: 2,
        cgroup_path: Some("/cgroup/canceled".to_owned()),
        child_pid: Some(123),
        ..Default::default()
    }
}

struct Harness {
    admin: PgPool,
    schema: String,
    store: PgJobStore,
}

impl Harness {
    async fn new() -> Self {
        let url = std::env::var("LAEUFER_STORE_TEST_DATABASE_URL")
            .expect("dedicated development Postgres URL");
        let admin = PgPoolOptions::new()
            .max_connections(1)
            .connect(&url)
            .await
            .expect("connect Postgres");
        sqlx::query("CREATE EXTENSION IF NOT EXISTS pgcrypto")
            .execute(&admin)
            .await
            .expect("pgcrypto");
        let schema = format!("rust_cancel_{}", Uuid::new_v4().simple());
        sqlx::query(&format!("CREATE SCHEMA {schema}"))
            .execute(&admin)
            .await
            .expect("unique isolated schema");
        let search_path = format!("SET search_path TO {schema}, public");
        let pool = PgPoolOptions::new()
            .max_connections(3)
            .after_connect(move |connection, _| {
                let query = search_path.clone();
                Box::pin(async move {
                    sqlx::query(&query).execute(connection).await?;
                    Ok(())
                })
            })
            .connect(&url)
            .await
            .expect("isolated pool");
        sqlx::raw_sql(include_str!("../../../../speicher/schema.sql"))
            .execute(&pool)
            .await
            .expect("application schema");
        Self {
            admin,
            schema,
            store: PgJobStore::new(pool),
        }
    }

    async fn lease_job(&self, runner: &str) -> Job {
        sqlx::query("INSERT INTO jobs (language, runtime_version, archive_targz, compile_timeout_ms, run_timeout_ms, memory_limit_bytes, cpu_millis, max_output_bytes) VALUES ('python', 'system', '\\x01'::bytea, 1000, 1000, 1048576, 1000, 4096)")
            .execute(self.store.pool()).await.expect("queued fixture");
        self.store
            .lease_next(runner, Duration::from_secs(30), 3)
            .await
            .expect("lease")
            .expect("queued job")
    }

    async fn close(self) {
        self.store.pool().close().await;
        sqlx::query(&format!("DROP SCHEMA {} CASCADE", self.schema))
            .execute(&self.admin)
            .await
            .expect("remove own schema");
        self.admin.close().await;
    }
}
