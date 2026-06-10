use anyhow::{Context, Result};
use laeufer_core::{execute_job, AttemptId, JobId, JobStatus, JobStore, RunnerConfig, Sandbox};
use laeufer_sandbox::LinuxSandbox;
use laeufer_sprachen::{ArchiveLimits, SprachenRuntime, SprachenRuntimeOptions};
use laeufer_store::PgJobStore;
use std::fs;
use std::time::Duration;
use tokio::time;

#[tokio::main]
async fn main() -> Result<()> {
    let config = RunnerConfig::from_env().context("load runner config")?;
    fs::create_dir_all(&config.work_dir).context("create runner work directory")?;

    let store = PgJobStore::connect(&config.database_url)
        .await
        .context("connect to postgres")?;
    let mut queue_notifications = match store.subscribe_job_queue().await {
        Ok(receiver) => Some(receiver),
        Err(error) => {
            eprintln!("job queue notifications unavailable; falling back to polling: {error}");
            None
        }
    };
    let runtime = SprachenRuntime::with_options(
        &config.work_dir,
        SprachenRuntimeOptions {
            archive_limits: ArchiveLimits {
                max_archive_bytes: config.max_archive_bytes,
                max_files: config.max_archive_files,
            },
            compile_memory_limit_bytes: config.compile_memory_limit_bytes,
        },
    );
    let sandbox = LinuxSandbox::from_env().context("load sandbox config")?;
    sandbox.preflight().await.context("sandbox preflight")?;

    eprintln!(
        "laeufer runner {} started; polling every {} ms",
        config.runner_id,
        config.poll_interval.as_millis()
    );

    let mut shutdown = Box::pin(shutdown_signal());
    loop {
        let lease = tokio::select! {
            _ = &mut shutdown => {
                eprintln!("shutdown requested");
                break;
            }
            lease = store.lease_next(&config.runner_id, config.lease_ttl, config.max_attempts) => lease,
        };

        match lease {
            Ok(Some(job)) => {
                let job_id = job.job_id;
                let attempt_id = job.attempt_id;
                let heartbeat = LeaseHeartbeat::spawn(
                    store.clone(),
                    config.runner_id.clone(),
                    attempt_id,
                    job_id,
                    config.lease_ttl,
                );
                let cancel_watcher =
                    CancelWatcher::spawn(store.clone(), job_id, config.poll_interval);
                let mut cancel_rx = cancel_watcher.receiver();
                match execute_job(
                    &store,
                    &config.runner_id,
                    &runtime,
                    &sandbox,
                    job,
                    &mut cancel_rx,
                )
                .await
                {
                    Ok(status) => {
                        eprintln!("job {job_id} finished with {status}");
                    }
                    Err(error) => {
                        eprintln!("job {job_id} failed in runner: {error}");
                    }
                }
                cancel_watcher.stop().await;
                heartbeat.stop().await;
            }
            Ok(None) => {
                tokio::select! {
                    _ = &mut shutdown => {
                        eprintln!("shutdown requested");
                        break;
                    }
                    _ = wait_for_queue_notification(&mut queue_notifications) => {}
                    _ = time::sleep(config.poll_interval) => {}
                }
            }
            Err(error) => {
                eprintln!("lease failed: {error}");
                tokio::select! {
                    _ = &mut shutdown => {
                        eprintln!("shutdown requested");
                        break;
                    }
                    _ = wait_for_queue_notification(&mut queue_notifications) => {}
                    _ = time::sleep(config.poll_interval) => {}
                }
            }
        }
    }

    eprintln!("laeufer runner stopped");
    Ok(())
}

struct CancelWatcher {
    stop_tx: tokio::sync::oneshot::Sender<()>,
    cancel_rx: tokio::sync::watch::Receiver<bool>,
    task: tokio::task::JoinHandle<()>,
}

impl CancelWatcher {
    fn spawn(store: PgJobStore, job_id: JobId, interval: Duration) -> Self {
        let (stop_tx, mut stop_rx) = tokio::sync::oneshot::channel();
        let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
        let task = tokio::spawn(async move {
            let mut job_events = match store.subscribe_job_events(job_id).await {
                Ok(receiver) => Some(receiver),
                Err(error) => {
                    eprintln!(
                        "job {job_id} notifications unavailable; falling back to polling: {error}"
                    );
                    None
                }
            };
            loop {
                tokio::select! {
                    _ = &mut stop_rx => break,
                    _ = wait_for_job_event_or_poll(&mut job_events, cancel_poll_interval(interval)) => {
                        match store.current_status(job_id).await {
                            Ok(Some(JobStatus::Canceled)) => {
                                let _ = cancel_tx.send(true);
                                break;
                            }
                            Ok(Some(status)) if status.is_terminal() => break,
                            Ok(Some(_)) => {}
                            Ok(None) => break,
                            Err(error) => {
                                eprintln!("job {job_id} cancel watcher failed: {error}");
                                break;
                            }
                        }
                    }
                }
            }
        });
        Self {
            stop_tx,
            cancel_rx,
            task,
        }
    }

    fn receiver(&self) -> tokio::sync::watch::Receiver<bool> {
        self.cancel_rx.clone()
    }

    async fn stop(self) {
        let _ = self.stop_tx.send(());
        let _ = self.task.await;
    }
}

fn cancel_poll_interval(poll_interval: Duration) -> Duration {
    poll_interval.min(Duration::from_millis(250))
}

async fn wait_for_queue_notification(receiver: &mut Option<tokio::sync::watch::Receiver<u64>>) {
    let changed = match receiver.as_mut() {
        Some(receiver) => receiver.changed().await.is_ok(),
        None => {
            std::future::pending::<()>().await;
            return;
        }
    };
    if !changed {
        *receiver = None;
    }
}

async fn wait_for_job_event_or_poll(
    receiver: &mut Option<tokio::sync::watch::Receiver<u64>>,
    interval: Duration,
) {
    tokio::select! {
        _ = wait_for_queue_notification(receiver) => {}
        _ = time::sleep(interval) => {}
    }
}

struct LeaseHeartbeat {
    stop_tx: tokio::sync::oneshot::Sender<()>,
    task: tokio::task::JoinHandle<()>,
}

impl LeaseHeartbeat {
    fn spawn(
        store: PgJobStore,
        runner_id: String,
        attempt_id: AttemptId,
        job_id: JobId,
        lease_ttl: Duration,
    ) -> Self {
        let (stop_tx, mut stop_rx) = tokio::sync::oneshot::channel();
        let task = tokio::spawn(async move {
            let interval = heartbeat_interval(lease_ttl);
            let mut ticker = time::interval(interval);
            loop {
                tokio::select! {
                    _ = &mut stop_rx => break,
                    _ = ticker.tick() => {
                        if let Err(error) = store.renew_lease(&runner_id, attempt_id, job_id, lease_ttl).await {
                            eprintln!("job {job_id} lease heartbeat failed: {error}");
                            break;
                        }
                    }
                }
            }
        });
        Self { stop_tx, task }
    }

    async fn stop(self) {
        let _ = self.stop_tx.send(());
        let _ = self.task.await;
    }
}

fn heartbeat_interval(lease_ttl: Duration) -> Duration {
    let half = lease_ttl / 2;
    if half < Duration::from_secs(1) {
        Duration::from_secs(1)
    } else {
        half
    }
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};

        let mut terminate = signal(SignalKind::terminate()).expect("install SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = terminate.recv() => {}
        }
    }

    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn heartbeat_interval_has_one_second_floor() {
        assert_eq!(
            heartbeat_interval(Duration::from_millis(500)),
            Duration::from_secs(1)
        );
        assert_eq!(
            heartbeat_interval(Duration::from_secs(10)),
            Duration::from_secs(5)
        );
    }

    #[test]
    fn cancel_poll_interval_caps_at_250_ms() {
        assert_eq!(
            cancel_poll_interval(Duration::from_secs(1)),
            Duration::from_millis(250)
        );
        assert_eq!(
            cancel_poll_interval(Duration::from_millis(100)),
            Duration::from_millis(100)
        );
    }
}
