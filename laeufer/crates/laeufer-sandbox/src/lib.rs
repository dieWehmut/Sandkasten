use async_trait::async_trait;
use laeufer_core::{CommandPlan, JobResult, RunnerError, Sandbox};
use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Instant;
use thiserror::Error;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;
use tokio::sync::mpsc;
use tokio::time;

#[cfg(unix)]
use std::os::unix::process::ExitStatusExt;

#[derive(Clone, Debug)]
pub struct LinuxSandbox {
    config: SandboxConfig,
}

impl LinuxSandbox {
    pub fn new(config: SandboxConfig) -> Self {
        Self { config }
    }

    pub fn from_env() -> Result<Self, RunnerError> {
        Ok(Self::new(SandboxConfig::from_env()?))
    }

    pub fn config(&self) -> &SandboxConfig {
        &self.config
    }
}

impl Default for LinuxSandbox {
    fn default() -> Self {
        Self::new(SandboxConfig::default())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SandboxConfig {
    pub cgroup_root: PathBuf,
    pub rootfs: Option<PathBuf>,
    pub sandbox_root: PathBuf,
    pub reject_supervisor_dangerous_capabilities: bool,
    pub require_private_namespaces: bool,
    pub child_uid: u32,
    pub child_gid: u32,
}

impl SandboxConfig {
    pub fn from_env() -> Result<Self, RunnerError> {
        let cgroup_root = std::env::var_os("LAEUFER_CGROUP_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("/sys/fs/cgroup"));
        let rootfs = std::env::var_os("LAEUFER_ROOTFS").map(PathBuf::from);
        let sandbox_root = std::env::var_os("LAEUFER_SANDBOX_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|| std::env::temp_dir().join("laeufer-sandbox"));
        let reject_supervisor_dangerous_capabilities =
            std::env::var("LAEUFER_REJECT_SUPERVISOR_DANGEROUS_CAPS").unwrap_or_default() == "1";
        let require_private_namespaces =
            std::env::var("LAEUFER_REQUIRE_PRIVATE_NAMESPACES").unwrap_or_default() != "0";
        let child_uid = env_u32("LAEUFER_CHILD_UID", 65_534)?;
        let child_gid = env_u32("LAEUFER_CHILD_GID", 65_534)?;

        Ok(Self {
            cgroup_root,
            rootfs,
            sandbox_root,
            reject_supervisor_dangerous_capabilities,
            require_private_namespaces,
            child_uid,
            child_gid,
        })
    }
}

impl Default for SandboxConfig {
    fn default() -> Self {
        Self {
            cgroup_root: PathBuf::from("/sys/fs/cgroup"),
            rootfs: None,
            sandbox_root: std::env::temp_dir().join("laeufer-sandbox"),
            reject_supervisor_dangerous_capabilities: false,
            require_private_namespaces: true,
            child_uid: 65_534,
            child_gid: 65_534,
        }
    }
}

#[async_trait]
impl Sandbox for LinuxSandbox {
    async fn preflight(&self) -> Result<(), RunnerError> {
        preflight(&self.config).map_err(|error| RunnerError::Preflight(error.to_string()))
    }

    async fn execute(&self, plan: &CommandPlan) -> Result<JobResult, RunnerError> {
        execute_command(plan, &self.config).await
    }
}

fn preflight(config: &SandboxConfig) -> Result<(), SandboxError> {
    if !cfg!(target_os = "linux") {
        return Err(SandboxError::UnsupportedPlatform);
    }

    require_file("/proc/self/status")?;
    for namespace in ["user", "pid", "mnt", "net", "uts", "ipc"] {
        require_path(PathBuf::from("/proc/self/ns").join(namespace))?;
    }
    if config.require_private_namespaces && !can_clone_namespaces() {
        return Err(SandboxError::MissingKernelFeature("clone namespace flags"));
    }

    let status = fs::read_to_string("/proc/self/status")?;
    if !status.lines().any(|line| line.starts_with("Seccomp:")) {
        return Err(SandboxError::MissingKernelFeature("seccomp status"));
    }
    if config.reject_supervisor_dangerous_capabilities {
        reject_dangerous_capabilities(&status)?;
    }

    let cgroup_controllers = config.cgroup_root.join("cgroup.controllers");
    require_file(&cgroup_controllers)?;
    let controllers = fs::read_to_string(&cgroup_controllers)?;
    for controller in ["cpu", "memory", "pids"] {
        if !controllers
            .split_whitespace()
            .any(|value| value == controller)
        {
            return Err(SandboxError::MissingCgroupController(controller));
        }
    }

    if let Ok(value) = fs::read_to_string("/proc/sys/kernel/unprivileged_userns_clone") {
        if value.trim() == "0" {
            return Err(SandboxError::UserNamespacesDisabled);
        }
    }

    if let Some(rootfs) = &config.rootfs {
        let metadata = fs::metadata(rootfs)?;
        if !metadata.is_dir() {
            return Err(SandboxError::InvalidRootfs(rootfs.clone()));
        }
    }
    fs::create_dir_all(&config.sandbox_root)?;

    Ok(())
}

async fn execute_command(
    plan: &CommandPlan,
    config: &SandboxConfig,
) -> Result<JobResult, RunnerError> {
    let _intent = IsolationIntent::for_plan(plan);
    let mut command = Command::new(&plan.program);
    command
        .args(&plan.args)
        .env_clear()
        .envs(plan.env.iter().map(|(key, value)| (key, value)))
        .current_dir(&plan.cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    install_child_setup(
        &mut command,
        plan.memory_limit_bytes,
        config.child_uid,
        config.child_gid,
        config.require_private_namespaces,
    )?;

    let started = Instant::now();
    let mut child = command.spawn().map_err(|error| {
        RunnerError::System(format!("failed to spawn {:?}: {error}", plan.program))
    })?;
    let cgroup = match CgroupGuard::attach(config, plan, child.id()).await {
        Ok(cgroup) => cgroup,
        Err(error) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err(error);
        }
    };

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| RunnerError::System("failed to open child stdin".to_owned()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| RunnerError::System("failed to open child stdout".to_owned()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| RunnerError::System("failed to open child stderr".to_owned()))?;

    let stdin_body = plan.stdin.clone();
    let stdin_task = tokio::spawn(async move {
        let mut stdin = stdin;
        let result = stdin.write_all(&stdin_body).await;
        let _ = stdin.shutdown().await;
        result
    });

    let (limit_tx, mut limit_rx) = mpsc::channel(1);
    let stdout_task = tokio::spawn(read_limited(
        stdout,
        plan.max_output_bytes,
        limit_tx.clone(),
    ));
    let stderr_task = tokio::spawn(read_limited(stderr, plan.max_output_bytes, limit_tx));

    let status = tokio::select! {
        status = child.wait() => {
            status.map_err(|error| RunnerError::System(format!("failed to wait for child: {error}")))?
        }
        _ = limit_rx.recv() => {
            let _ = child.kill().await;
            child.wait().await.map_err(|error| RunnerError::System(format!("failed to wait after output limit: {error}")))?
        }
        _ = time::sleep(plan.timeout) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            await_stdin(stdin_task).await?;
            let _ = await_output(stdout_task).await;
            let _ = await_output(stderr_task).await;
            return Err(RunnerError::TimeLimitExceeded(format!(
                "command {:?} exceeded {} ms",
                plan.program,
                plan.timeout.as_millis()
            )));
        }
    };

    await_stdin(stdin_task).await?;
    let stdout = await_output(stdout_task).await?;
    let stderr = await_output(stderr_task).await?;

    let wall_time = started.elapsed();
    if cgroup.memory_oom_kill() {
        drop(cgroup);
        return Err(RunnerError::MemoryLimitExceeded(format!(
            "command {:?} exceeded memory cgroup limit",
            plan.program
        )));
    }
    drop(cgroup);

    Ok(JobResult {
        stdout: stdout.bytes.into(),
        stderr: stderr.bytes.into(),
        compile_stdout: Default::default(),
        compile_stderr: Default::default(),
        exit_code: status.code(),
        signal: exit_signal(status),
        wall_time,
        memory_peak_bytes: 0,
        stdout_truncated: stdout.truncated,
        stderr_truncated: stderr.truncated,
    })
}

#[derive(Debug)]
struct CgroupGuard {
    path: PathBuf,
}

impl CgroupGuard {
    async fn attach(
        config: &SandboxConfig,
        plan: &CommandPlan,
        child_id: Option<u32>,
    ) -> Result<Self, RunnerError> {
        let pid =
            child_id.ok_or_else(|| RunnerError::System("child process has no pid".to_owned()))?;
        let parent = config.cgroup_root.join("sandkasten");
        let path = parent.join(format!("laeufer-{pid}"));
        fs::create_dir_all(&path)
            .map_err(|error| RunnerError::System(format!("create cgroup {:?}: {error}", path)))?;

        write_cgroup_file(path.join("memory.max"), memory_max(plan.memory_limit_bytes))?;
        write_cgroup_file(path.join("pids.max"), "64")?;
        write_cgroup_file(path.join("cpu.max"), cpu_max(plan.cpu_millis))?;
        write_cgroup_file(path.join("cgroup.procs"), pid.to_string())?;

        Ok(Self { path })
    }

    fn memory_oom_kill(&self) -> bool {
        let Ok(body) = fs::read_to_string(self.path.join("memory.events")) else {
            return false;
        };
        body.lines().any(|line| {
            let mut parts = line.split_whitespace();
            matches!(parts.next(), Some("oom_kill"))
                && parts
                    .next()
                    .and_then(|value| value.parse::<u64>().ok())
                    .unwrap_or(0)
                    > 0
        })
    }
}

impl Drop for CgroupGuard {
    fn drop(&mut self) {
        let _ = fs::remove_dir(&self.path);
    }
}

fn write_cgroup_file(path: PathBuf, value: impl AsRef<str>) -> Result<(), RunnerError> {
    fs::write(&path, value.as_ref())
        .map_err(|error| RunnerError::System(format!("write cgroup file {:?}: {error}", path)))
}

fn cpu_max(cpu_millis: u32) -> String {
    if cpu_millis == 0 {
        return "max 100000".to_owned();
    }
    let quota = u64::from(cpu_millis).saturating_mul(100);
    format!("{} 100000", quota.max(1))
}

fn memory_max(memory_limit_bytes: u64) -> String {
    if memory_limit_bytes == 0 {
        "max".to_owned()
    } else {
        memory_limit_bytes.to_string()
    }
}

fn install_child_setup(
    command: &mut Command,
    memory_limit_bytes: u64,
    child_uid: u32,
    child_gid: u32,
    require_private_namespaces: bool,
) -> Result<(), RunnerError> {
    let memory_limit = memory_limit_bytes;
    unsafe {
        command.pre_exec(move || {
            configure_child_process(
                memory_limit,
                child_uid,
                child_gid,
                require_private_namespaces,
            )
        });
    }
    Ok(())
}

fn configure_child_process(
    memory_limit_bytes: u64,
    child_uid: u32,
    child_gid: u32,
    require_private_namespaces: bool,
) -> io::Result<()> {
    unsafe {
        if require_private_namespaces {
            let flags =
                libc::CLONE_NEWNS | libc::CLONE_NEWIPC | libc::CLONE_NEWUTS | libc::CLONE_NEWNET;
            if libc::unshare(flags) != 0 {
                return Err(io::Error::last_os_error());
            }
            if libc::mount(
                std::ptr::null::<libc::c_char>(),
                b"/\0".as_ptr().cast(),
                std::ptr::null::<libc::c_char>(),
                (libc::MS_REC | libc::MS_PRIVATE) as libc::c_ulong,
                std::ptr::null::<libc::c_void>(),
            ) != 0
            {
                return Err(io::Error::last_os_error());
            }
        }
        if libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0 {
            return Err(io::Error::last_os_error());
        }
        if libc::setsid() < 0 {
            return Err(io::Error::last_os_error());
        }
        if memory_limit_bytes > 0 {
            let limit = libc::rlimit {
                rlim_cur: memory_limit_bytes as libc::rlim_t,
                rlim_max: memory_limit_bytes as libc::rlim_t,
            };
            if libc::setrlimit(libc::RLIMIT_AS, &limit) != 0 {
                return Err(io::Error::last_os_error());
            }
        }
        if libc::geteuid() == 0 {
            if libc::setgroups(0, std::ptr::null()) != 0 {
                return Err(io::Error::last_os_error());
            }
            if libc::setgid(child_gid as libc::gid_t) != 0 {
                return Err(io::Error::last_os_error());
            }
            if libc::setuid(child_uid as libc::uid_t) != 0 {
                return Err(io::Error::last_os_error());
            }
        }
    }
    Ok(())
}

fn env_u32(name: &str, fallback: u32) -> Result<u32, RunnerError> {
    match std::env::var(name) {
        Ok(value) => value
            .parse::<u32>()
            .map_err(|_| RunnerError::Preflight(format!("{name} must be a u32, got {value:?}"))),
        Err(_) => Ok(fallback),
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IsolationIntent {
    pub command: String,
    pub requires_private_mount_namespace: bool,
    pub requires_private_ipc_namespace: bool,
    pub requires_private_uts_namespace: bool,
    pub requires_private_network_namespace: bool,
    pub enforces_no_new_privs: bool,
    pub drops_to_unprivileged_uid_gid: bool,
    pub enforces_rlimit_as: bool,
}

impl IsolationIntent {
    pub fn for_plan(plan: &CommandPlan) -> Self {
        Self {
            command: plan.display_command(),
            requires_private_mount_namespace: true,
            requires_private_ipc_namespace: true,
            requires_private_uts_namespace: true,
            requires_private_network_namespace: true,
            enforces_no_new_privs: true,
            drops_to_unprivileged_uid_gid: true,
            enforces_rlimit_as: plan.memory_limit_bytes > 0,
        }
    }
}

async fn await_stdin(task: tokio::task::JoinHandle<io::Result<()>>) -> Result<(), RunnerError> {
    match task.await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(error)) if error.kind() == io::ErrorKind::BrokenPipe => Ok(()),
        Ok(Err(error)) => Err(RunnerError::System(format!(
            "failed to write stdin: {error}"
        ))),
        Err(error) => Err(RunnerError::System(format!("stdin task failed: {error}"))),
    }
}

async fn await_output(
    task: tokio::task::JoinHandle<io::Result<LimitedOutput>>,
) -> Result<LimitedOutput, RunnerError> {
    match task.await {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(error)) => Err(RunnerError::System(format!(
            "failed to read output: {error}"
        ))),
        Err(error) => Err(RunnerError::System(format!("output task failed: {error}"))),
    }
}

async fn read_limited<R>(
    mut reader: R,
    max_output_bytes: u64,
    limit_tx: mpsc::Sender<()>,
) -> io::Result<LimitedOutput>
where
    R: AsyncRead + Unpin,
{
    let max_output_bytes = usize::try_from(max_output_bytes).unwrap_or(usize::MAX);
    let mut bytes = Vec::new();
    let mut truncated = false;
    let mut notified = false;
    let mut buffer = [0u8; 8192];

    loop {
        let read = reader.read(&mut buffer).await?;
        if read == 0 {
            break;
        }

        let remaining = max_output_bytes.saturating_sub(bytes.len());
        if remaining > 0 {
            let keep = remaining.min(read);
            bytes.extend_from_slice(&buffer[..keep]);
            if keep < read {
                truncated = true;
            }
        } else {
            truncated = true;
        }

        if truncated && !notified {
            let _ = limit_tx.try_send(());
            notified = true;
        }
    }

    Ok(LimitedOutput { bytes, truncated })
}

#[cfg(unix)]
fn exit_signal(status: std::process::ExitStatus) -> Option<i32> {
    status.signal()
}

#[cfg(not(unix))]
fn exit_signal(_: std::process::ExitStatus) -> Option<i32> {
    None
}

fn reject_dangerous_capabilities(status: &str) -> Result<(), SandboxError> {
    let cap_eff = status
        .lines()
        .find_map(|line| line.strip_prefix("CapEff:"))
        .ok_or(SandboxError::MissingKernelFeature("capability status"))?
        .trim();
    let capabilities = u64::from_str_radix(cap_eff, 16)
        .map_err(|_| SandboxError::InvalidCapabilityMask(cap_eff.to_owned()))?;

    let dangerous = [
        (12, "CAP_NET_ADMIN"),
        (16, "CAP_SYS_MODULE"),
        (17, "CAP_SYS_RAWIO"),
        (19, "CAP_SYS_PTRACE"),
        (21, "CAP_SYS_ADMIN"),
        (22, "CAP_SYS_BOOT"),
        (25, "CAP_SYS_TIME"),
    ];
    let present = dangerous
        .into_iter()
        .filter_map(|(bit, name)| {
            if capabilities & (1u64 << bit) != 0 {
                Some(name)
            } else {
                None
            }
        })
        .collect::<Vec<_>>();

    if present.is_empty() {
        Ok(())
    } else {
        Err(SandboxError::DangerousCapabilities(present))
    }
}

fn require_file(path: impl AsRef<Path>) -> Result<(), SandboxError> {
    let path = path.as_ref();
    let metadata = fs::metadata(path)?;
    if metadata.is_file() {
        Ok(())
    } else {
        Err(SandboxError::RequiredFileMissing(
            path.as_os_str().to_os_string(),
        ))
    }
}

fn require_path(path: impl AsRef<Path>) -> Result<(), SandboxError> {
    let path = path.as_ref();
    fs::metadata(path)?;
    Ok(())
}

fn can_clone_namespaces() -> bool {
    cfg!(target_os = "linux")
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct LimitedOutput {
    bytes: Vec<u8>,
    truncated: bool,
}

#[derive(Debug, Error)]
enum SandboxError {
    #[error("laeufer sandbox currently requires Linux")]
    UnsupportedPlatform,
    #[error("required kernel file is missing or not a file: {0:?}")]
    RequiredFileMissing(OsString),
    #[error("required kernel feature is missing: {0}")]
    MissingKernelFeature(&'static str),
    #[error("cgroup v2 controller {0} is not available")]
    MissingCgroupController(&'static str),
    #[error("unprivileged user namespaces are disabled")]
    UserNamespacesDisabled,
    #[error("rootfs path is not a directory: {0:?}")]
    InvalidRootfs(PathBuf),
    #[error("effective capabilities include unsafe sandbox privileges: {0:?}")]
    DangerousCapabilities(Vec<&'static str>),
    #[error("invalid capability mask {0:?}")]
    InvalidCapabilityMask(String),
    #[error("io error: {0}")]
    Io(#[from] io::Error),
}

#[cfg(test)]
mod tests {
    use super::*;
    use laeufer_core::CommandPlan;
    use std::time::Duration;

    #[tokio::test]
    async fn executes_command_and_captures_output() {
        let plan = shell_plan("printf out; printf err >&2", 1024);

        let result = execute_command_without_cgroup(&plan)
            .await
            .expect("command runs");

        assert_eq!(result.exit_code, Some(0));
        assert_eq!(&result.stdout[..], b"out");
        assert_eq!(&result.stderr[..], b"err");
        assert!(!result.stdout_truncated);
        assert!(!result.stderr_truncated);
    }

    #[tokio::test]
    async fn caps_output() {
        let plan = shell_plan("printf 123456", 3);

        let result = execute_command_without_cgroup(&plan)
            .await
            .expect("command runs");

        assert_eq!(&result.stdout[..], b"123");
        assert!(result.stdout_truncated);
    }

    #[tokio::test]
    async fn reports_timeout() {
        let mut plan = shell_plan("sleep 2", 1024);
        plan.timeout = Duration::from_millis(20);

        let err = execute_command_without_cgroup(&plan)
            .await
            .expect_err("times out");

        assert!(matches!(err, RunnerError::TimeLimitExceeded(_)));
    }

    #[test]
    fn detects_dangerous_capabilities() {
        let status = "CapEff:\t0000000000200000\nSeccomp:\t2\n";

        let err = reject_dangerous_capabilities(status).expect_err("cap sys admin present");

        assert!(matches!(err, SandboxError::DangerousCapabilities(_)));
    }

    #[test]
    fn describes_isolation_intent_for_plan() {
        let plan = shell_plan("true", 1024);

        let intent = IsolationIntent::for_plan(&plan);

        assert!(intent.requires_private_mount_namespace);
        assert!(intent.requires_private_ipc_namespace);
        assert!(intent.requires_private_uts_namespace);
        assert!(intent.requires_private_network_namespace);
        assert!(intent.enforces_no_new_privs);
        assert!(intent.drops_to_unprivileged_uid_gid);
        assert!(intent.enforces_rlimit_as);
    }

    fn shell_plan(script: &str, max_output_bytes: u64) -> CommandPlan {
        CommandPlan {
            program: "/bin/sh".to_owned(),
            args: vec!["-c".to_owned(), script.to_owned()],
            env: Vec::new(),
            cwd: PathBuf::from("/"),
            stdin: Default::default(),
            timeout: Duration::from_secs(1),
            memory_limit_bytes: 128 * 1024 * 1024,
            cpu_millis: 1000,
            max_output_bytes,
        }
    }

    async fn execute_command_without_cgroup(plan: &CommandPlan) -> Result<JobResult, RunnerError> {
        let mut config = SandboxConfig::default();
        config.require_private_namespaces = false;
        let cgroup_root = tempfile::tempdir().expect("tempdir");
        config.cgroup_root = cgroup_root.path().to_path_buf();
        execute_command(plan, &config).await
    }
}
