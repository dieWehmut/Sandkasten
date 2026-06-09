use anyhow::{Context, Result};
use laeufer_core::{execute_job, JobStore, RunnerConfig, Sandbox};
use laeufer_sandbox::LinuxSandbox;
use laeufer_sprachen::{ArchiveLimits, SprachenRuntime, SprachenRuntimeOptions};
use laeufer_store::PgJobStore;
use std::fs;
use tokio::time;

#[tokio::main]
async fn main() -> Result<()> {
    let config = RunnerConfig::from_env().context("load runner config")?;
    fs::create_dir_all(&config.work_dir).context("create runner work directory")?;

    let store = PgJobStore::connect(&config.database_url)
        .await
        .context("connect to postgres")?;
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
            lease = store.lease_next(&config.runner_id, config.lease_ttl) => lease,
        };

        match lease {
            Ok(Some(job)) => {
                let job_id = job.job_id;
                match execute_job(&store, &runtime, &sandbox, job).await {
                    Ok(status) => {
                        eprintln!("job {job_id} finished with {status}");
                    }
                    Err(error) => {
                        eprintln!("job {job_id} failed in runner: {error}");
                    }
                }
            }
            Ok(None) => {
                tokio::select! {
                    _ = &mut shutdown => {
                        eprintln!("shutdown requested");
                        break;
                    }
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
                    _ = time::sleep(config.poll_interval) => {}
                }
            }
        }
    }

    eprintln!("laeufer runner stopped");
    Ok(())
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
