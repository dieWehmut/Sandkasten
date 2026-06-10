use async_trait::async_trait;
use laeufer_core::{
    CancellationReceiver, CommandPlan, JobResult, RunnerError, Sandbox, SeccompProfile,
};
use std::ffi::{CStr, CString, OsString};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use thiserror::Error;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;
use tokio::time;

#[cfg(unix)]
use std::os::unix::ffi::OsStrExt;
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
    pub pids_max: u64,
    pub memory_swap_max_bytes: Option<u64>,
    pub reject_supervisor_dangerous_capabilities: bool,
    pub require_private_namespaces: bool,
    pub enable_seccomp: bool,
    pub child_uid: u32,
    pub child_gid: u32,
    pub child_rlimits: ChildRlimits,
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
        let pids_max = env_u64("LAEUFER_PIDS_MAX", DEFAULT_PIDS_MAX)?;
        let memory_swap_max_bytes = optional_env_u64("LAEUFER_MEMORY_SWAP_MAX_BYTES")?;
        let reject_supervisor_dangerous_capabilities =
            std::env::var("LAEUFER_REJECT_SUPERVISOR_DANGEROUS_CAPS").unwrap_or_default() == "1";
        let require_private_namespaces =
            std::env::var("LAEUFER_REQUIRE_PRIVATE_NAMESPACES").unwrap_or_default() != "0";
        let enable_seccomp = std::env::var("LAEUFER_DISABLE_SECCOMP").unwrap_or_default() != "1";
        let child_uid = env_u32("LAEUFER_CHILD_UID", 65_534)?;
        let child_gid = env_u32("LAEUFER_CHILD_GID", 65_534)?;
        let child_rlimits = ChildRlimits::from_env()?;

        Ok(Self {
            cgroup_root,
            rootfs,
            sandbox_root,
            pids_max,
            memory_swap_max_bytes,
            reject_supervisor_dangerous_capabilities,
            require_private_namespaces,
            enable_seccomp,
            child_uid,
            child_gid,
            child_rlimits,
        })
    }
}

impl Default for SandboxConfig {
    fn default() -> Self {
        Self {
            cgroup_root: PathBuf::from("/sys/fs/cgroup"),
            rootfs: None,
            sandbox_root: std::env::temp_dir().join("laeufer-sandbox"),
            pids_max: DEFAULT_PIDS_MAX,
            memory_swap_max_bytes: None,
            reject_supervisor_dangerous_capabilities: false,
            require_private_namespaces: true,
            enable_seccomp: true,
            child_uid: 65_534,
            child_gid: 65_534,
            child_rlimits: ChildRlimits::default(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ChildRlimits {
    pub cpu_seconds: Option<u64>,
    pub core_bytes: u64,
    pub file_size_bytes: u64,
    pub nofile: u64,
    pub nproc: u64,
    pub stack_bytes: u64,
    pub memlock_bytes: u64,
}

impl ChildRlimits {
    fn from_env() -> Result<Self, RunnerError> {
        Ok(Self {
            cpu_seconds: optional_nonzero_env_u64("LAEUFER_RLIMIT_CPU_SECONDS")?,
            core_bytes: env_u64("LAEUFER_RLIMIT_CORE_BYTES", 0)?,
            file_size_bytes: env_u64("LAEUFER_RLIMIT_FSIZE_BYTES", 64 * 1024 * 1024)?,
            nofile: env_u64("LAEUFER_RLIMIT_NOFILE", 1024)?,
            nproc: env_u64("LAEUFER_RLIMIT_NPROC", DEFAULT_PIDS_MAX)?,
            stack_bytes: env_u64("LAEUFER_RLIMIT_STACK_BYTES", 64 * 1024 * 1024)?,
            memlock_bytes: env_u64("LAEUFER_RLIMIT_MEMLOCK_BYTES", 0)?,
        })
    }
}

impl Default for ChildRlimits {
    fn default() -> Self {
        Self {
            cpu_seconds: None,
            core_bytes: 0,
            file_size_bytes: 64 * 1024 * 1024,
            nofile: 1024,
            nproc: DEFAULT_PIDS_MAX,
            stack_bytes: 64 * 1024 * 1024,
            memlock_bytes: 0,
        }
    }
}

#[async_trait]
impl Sandbox for LinuxSandbox {
    async fn preflight(&self) -> Result<(), RunnerError> {
        preflight(&self.config).map_err(|error| RunnerError::Preflight(error.to_string()))
    }

    async fn execute(
        &self,
        plan: &CommandPlan,
        cancel: &mut CancellationReceiver,
    ) -> Result<JobResult, RunnerError> {
        execute_command(plan, &self.config, cancel).await
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
    if config.rootfs.is_some() && !config.require_private_namespaces {
        return Err(SandboxError::RootfsRequiresMountNamespace);
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
    for controller in REQUIRED_CGROUP_CONTROLLERS {
        if !controllers
            .split_whitespace()
            .any(|value| value == controller)
        {
            return Err(SandboxError::MissingCgroupController(controller));
        }
    }
    ensure_runner_cgroup(&config.cgroup_root)?;

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
    cancel: &mut CancellationReceiver,
) -> Result<JobResult, RunnerError> {
    enable_child_subreaper()?;
    let execution_plan = execution_plan_for_rootfs(plan, config.rootfs.is_some());
    let _intent = IsolationIntent::for_plan(&execution_plan.plan);
    let cgroup = CgroupGuard::prepare(config, &execution_plan.plan)?;
    let mut command = Command::new(&execution_plan.plan.program);
    command
        .args(&execution_plan.plan.args)
        .env_clear()
        .envs(
            execution_plan
                .plan
                .env
                .iter()
                .map(|(key, value)| (key, value)),
        )
        .current_dir(&execution_plan.host_cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    install_child_setup(
        &mut command,
        ChildSetup {
            options: ChildSetupOptions {
                child_uid: config.child_uid,
                child_gid: config.child_gid,
                require_private_namespaces: config.require_private_namespaces,
                enable_seccomp: config.enable_seccomp,
                child_rlimits: config.child_rlimits,
                seccomp_profile: execution_plan.plan.seccomp_profile,
            },
            cgroup_procs_path: cgroup.procs_path(),
            rootfs: config.rootfs.as_deref(),
            workspace_host: &execution_plan.workspace_host,
            guest_cwd: &execution_plan.plan.cwd,
        },
    )?;

    let started = Instant::now();
    let mut child = command.spawn().map_err(|error| {
        RunnerError::System(format!("failed to spawn {:?}: {error}", plan.program))
    })?;
    let child_pid = child.id();
    let cgroup_path = cgroup.path.display().to_string();

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
        execution_plan.plan.max_output_bytes,
        limit_tx.clone(),
    ));
    let stderr_task = tokio::spawn(read_limited(
        stderr,
        execution_plan.plan.max_output_bytes,
        limit_tx,
    ));

    let status = tokio::select! {
        status = child.wait() => {
            status.map_err(|error| RunnerError::System(format!("failed to wait for child: {error}")))?
        }
        _ = limit_rx.recv() => {
            terminate_child(&mut child, Some(&cgroup)).await;
            child.wait().await.map_err(|error| RunnerError::System(format!("failed to wait after output limit: {error}")))?
        }
        _ = wait_for_cancellation(cancel) => {
            terminate_child(&mut child, Some(&cgroup)).await;
            let _ = child.wait().await;
            await_stdin(stdin_task).await?;
            let _ = await_output(stdout_task).await;
            let _ = await_output(stderr_task).await;
            cgroup.kill_all_and_wait_empty().await?;
            return Err(RunnerError::Canceled(format!(
                "command {:?} canceled",
                plan.program
            )));
        }
        _ = time::sleep(execution_plan.plan.timeout) => {
            terminate_child(&mut child, Some(&cgroup)).await;
            let _ = child.wait().await;
            await_stdin(stdin_task).await?;
            let _ = await_output(stdout_task).await;
            let _ = await_output(stderr_task).await;
            cgroup.kill_all_and_wait_empty().await?;
            return Err(RunnerError::TimeLimitExceeded(format!(
                "command {:?} exceeded {} ms",
                execution_plan.plan.program,
                execution_plan.plan.timeout.as_millis()
            )));
        }
    };

    cgroup.kill_all_and_wait_empty().await?;
    await_stdin(stdin_task).await?;
    let stdout = await_output(stdout_task).await?;
    let stderr = await_output(stderr_task).await?;

    let wall_time = started.elapsed();
    let cgroup_stats = cgroup.stats();
    if cgroup_stats.memory_oom_kill_count > 0 {
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
        memory_peak_bytes: cgroup_stats.memory_peak_bytes,
        stdout_truncated: stdout.truncated,
        stderr_truncated: stderr.truncated,
        cpu_usage_usec: cgroup_stats.cpu_usage_usec,
        cpu_throttled_usec: cgroup_stats.cpu_throttled_usec,
        pids_peak: cgroup_stats.pids_peak,
        memory_oom_kill_count: cgroup_stats.memory_oom_kill_count,
        cgroup_path: Some(cgroup_path),
        child_pid,
    })
}

fn enable_child_subreaper() -> Result<(), RunnerError> {
    #[cfg(unix)]
    {
        let result = unsafe { libc::prctl(libc::PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) };
        if result != 0 {
            return Err(RunnerError::System(format!(
                "enable child subreaper: {}",
                io::Error::last_os_error()
            )));
        }
    }
    Ok(())
}

#[derive(Debug)]
struct CgroupGuard {
    path: PathBuf,
    procs_path: PathBuf,
    supports_kernel_kill: bool,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
struct CgroupStats {
    memory_peak_bytes: u64,
    memory_oom_kill_count: u64,
    cpu_usage_usec: u64,
    cpu_throttled_usec: u64,
    pids_peak: u64,
}

const RUNNER_CGROUP_NAME: &str = "sandkasten";
const REQUIRED_CGROUP_CONTROLLERS: [&str; 3] = ["cpu", "memory", "pids"];
const DEFAULT_PIDS_MAX: u64 = 64;
const GUEST_WORKSPACE: &str = "/workspace";
const EMPTY_MASK_DIR: &CStr = c"/.sandkasten-empty";
const OLD_ROOT_NAME: &str = ".sandkasten-old-root";
const CGROUP_EMPTY_WAIT_TIMEOUT: Duration = Duration::from_millis(500);
const CGROUP_EMPTY_POLL_INTERVAL: Duration = Duration::from_millis(10);
static NEXT_CGROUP_ID: AtomicU64 = AtomicU64::new(1);

impl CgroupGuard {
    fn prepare(config: &SandboxConfig, plan: &CommandPlan) -> Result<Self, RunnerError> {
        let parent = ensure_runner_cgroup(&config.cgroup_root)
            .map_err(|error| RunnerError::System(format!("prepare runner cgroup: {error}")))?;
        let id = NEXT_CGROUP_ID.fetch_add(1, Ordering::Relaxed);
        let path = parent.join(format!("laeufer-{}-{id}", std::process::id()));
        let procs_path = path.join("cgroup.procs");
        fs::create_dir_all(&path)
            .map_err(|error| RunnerError::System(format!("create cgroup {:?}: {error}", path)))?;
        let supports_kernel_kill = path.join("cgroup.kill").exists();

        write_cgroup_file(path.join("memory.max"), memory_max(plan.memory_limit_bytes))?;
        write_cgroup_file(path.join("memory.oom.group"), "1")?;
        if let Some(swap_max) = config.memory_swap_max_bytes {
            write_cgroup_file(path.join("memory.swap.max"), memory_swap_max(swap_max))?;
        }
        write_cgroup_file(path.join("pids.max"), pids_max(config.pids_max))?;
        write_cgroup_file(path.join("cpu.max"), cpu_max(plan.cpu_millis))?;
        #[cfg(test)]
        fs::write(&procs_path, "")
            .map_err(|error| RunnerError::System(format!("create fake cgroup.procs: {error}")))?;

        Ok(Self {
            path,
            procs_path,
            supports_kernel_kill,
        })
    }

    fn procs_path(&self) -> &Path {
        &self.procs_path
    }

    fn stats(&self) -> CgroupStats {
        let memory_events = read_keyed_cgroup_u64(self.path.join("memory.events"));
        let cpu_stat = read_keyed_cgroup_u64(self.path.join("cpu.stat"));
        CgroupStats {
            memory_peak_bytes: self.memory_peak_bytes(),
            memory_oom_kill_count: keyed_value(&memory_events, "oom_kill"),
            cpu_usage_usec: keyed_value(&cpu_stat, "usage_usec"),
            cpu_throttled_usec: keyed_value(&cpu_stat, "throttled_usec"),
            pids_peak: self.pids_peak(),
        }
    }

    fn memory_peak_bytes(&self) -> u64 {
        read_cgroup_u64(self.path.join("memory.peak")).unwrap_or(0)
    }

    fn pids_peak(&self) -> u64 {
        read_cgroup_u64(self.path.join("pids.peak"))
            .or_else(|_| read_cgroup_u64(self.path.join("pids.current")))
            .unwrap_or(0)
    }

    fn kill_all(&self) {
        let _ = fs::write(self.path.join("cgroup.kill"), "1");

        let Ok(pids) = self.member_pids() else {
            return;
        };
        for pid in pids {
            kill_pid(pid);
        }
    }

    async fn kill_all_and_wait_empty(&self) -> Result<(), RunnerError> {
        self.kill_all();
        if !self.supports_kernel_kill {
            return Ok(());
        }
        let deadline = Instant::now() + CGROUP_EMPTY_WAIT_TIMEOUT;
        loop {
            let pids = self.member_pids().map_err(|error| {
                RunnerError::System(format!("read cgroup procs {:?}: {error}", self.procs_path))
            })?;
            reap_cgroup_member_children(&pids).map_err(|error| {
                RunnerError::System(format!("reap cgroup member children: {error}"))
            })?;
            let pids = self.member_pids().map_err(|error| {
                RunnerError::System(format!("read cgroup procs {:?}: {error}", self.procs_path))
            })?;
            if pids.is_empty() {
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err(RunnerError::System(format!(
                    "cgroup {:?} still has member processes after kill: {:?}",
                    self.path, pids
                )));
            }
            for pid in pids {
                kill_pid(pid);
            }
            time::sleep(CGROUP_EMPTY_POLL_INTERVAL).await;
        }
    }

    fn member_pids(&self) -> io::Result<Vec<libc::pid_t>> {
        let procs = fs::read_to_string(&self.procs_path)?;
        Ok(procs
            .lines()
            .filter_map(|line| line.trim().parse().ok())
            .collect())
    }
}

fn ensure_runner_cgroup(cgroup_root: &Path) -> io::Result<PathBuf> {
    let parent = cgroup_root.join(RUNNER_CGROUP_NAME);
    fs::create_dir_all(&parent)?;
    enable_cgroup_controllers(&parent, &REQUIRED_CGROUP_CONTROLLERS)?;
    Ok(parent)
}

fn enable_cgroup_controllers(cgroup: &Path, controllers: &[&str]) -> io::Result<()> {
    let available = fs::read_to_string(cgroup.join("cgroup.controllers"))?;
    let available = available.split_whitespace().collect::<Vec<_>>();
    let requested = controllers
        .iter()
        .copied()
        .filter(|controller| available.contains(controller))
        .map(|controller| format!("+{controller}"))
        .collect::<Vec<_>>();

    if requested.is_empty() {
        return Ok(());
    }

    fs::write(cgroup.join("cgroup.subtree_control"), requested.join(" "))
}

impl Drop for CgroupGuard {
    fn drop(&mut self) {
        let _ = fs::remove_dir(&self.path);
    }
}

#[derive(Debug)]
struct ExecutionPlan {
    plan: CommandPlan,
    host_cwd: PathBuf,
    workspace_host: PathBuf,
}

fn execution_plan_for_rootfs(plan: &CommandPlan, use_rootfs: bool) -> ExecutionPlan {
    if !use_rootfs {
        return ExecutionPlan {
            plan: plan.clone(),
            host_cwd: plan.cwd.clone(),
            workspace_host: plan.cwd.clone(),
        };
    }

    let workspace_host = plan.cwd.clone();
    let mut rewritten = plan.clone();
    rewritten.cwd = PathBuf::from(GUEST_WORKSPACE);
    rewritten.program = rewrite_path_for_workspace(&plan.program, &workspace_host);
    rewritten.args = plan
        .args
        .iter()
        .map(|arg| rewrite_path_for_workspace(arg, &workspace_host))
        .collect();
    rewritten.env = plan
        .env
        .iter()
        .map(|(key, value)| {
            (
                key.clone(),
                rewrite_path_for_workspace(value, &workspace_host),
            )
        })
        .collect();

    ExecutionPlan {
        plan: rewritten,
        host_cwd: workspace_host.clone(),
        workspace_host,
    }
}

fn rewrite_path_for_workspace(value: &str, workspace_host: &Path) -> String {
    let workspace = workspace_host.to_string_lossy();
    if workspace.is_empty() {
        return value.to_owned();
    }
    value.replace(workspace.as_ref(), GUEST_WORKSPACE)
}

fn write_cgroup_file(path: PathBuf, value: impl AsRef<str>) -> Result<(), RunnerError> {
    fs::write(&path, value.as_ref())
        .map_err(|error| RunnerError::System(format!("write cgroup file {:?}: {error}", path)))
}

fn read_cgroup_u64(path: PathBuf) -> io::Result<u64> {
    fs::read_to_string(path)?
        .trim()
        .parse::<u64>()
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

fn read_keyed_cgroup_u64(path: PathBuf) -> Vec<(String, u64)> {
    let Ok(body) = fs::read_to_string(path) else {
        return Vec::new();
    };
    body.lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let key = parts.next()?;
            let value = parts.next()?.parse::<u64>().ok()?;
            Some((key.to_owned(), value))
        })
        .collect()
}

fn keyed_value(values: &[(String, u64)], key: &str) -> u64 {
    values
        .iter()
        .find_map(|(candidate, value)| (candidate == key).then_some(*value))
        .unwrap_or(0)
}

async fn terminate_child(child: &mut Child, cgroup: Option<&CgroupGuard>) {
    kill_process_group(child.id());
    if let Some(cgroup) = cgroup {
        cgroup.kill_all();
    }
    let _ = child.kill().await;
}

async fn wait_for_cancellation(cancel: &mut CancellationReceiver) {
    loop {
        if *cancel.borrow() {
            return;
        }
        if cancel.changed().await.is_err() {
            std::future::pending::<()>().await;
        }
    }
}

#[cfg(unix)]
fn kill_process_group(child_id: Option<u32>) {
    let Some(child_id) = child_id else {
        return;
    };
    let Ok(pid) = i32::try_from(child_id) else {
        return;
    };
    if pid <= 1 {
        return;
    }
    unsafe {
        let _ = libc::kill(-pid, libc::SIGKILL);
    }
}

#[cfg(not(unix))]
fn kill_process_group(_: Option<u32>) {}

#[cfg(unix)]
fn kill_pid(pid: libc::pid_t) {
    if pid <= 1 {
        return;
    }
    unsafe {
        let _ = libc::kill(pid, libc::SIGKILL);
    }
}

#[cfg(not(unix))]
fn kill_pid(_: i32) {}

#[cfg(unix)]
fn reap_cgroup_member_children(pids: &[libc::pid_t]) -> io::Result<usize> {
    let mut reaped = 0;
    for pid in pids.iter().copied().filter(|pid| *pid > 1) {
        loop {
            let mut status = 0;
            let result = unsafe { libc::waitpid(pid, &mut status, libc::WNOHANG) };
            if result > 0 {
                reaped += 1;
                break;
            }
            if result == 0 {
                break;
            }
            let error = io::Error::last_os_error();
            match error.raw_os_error() {
                Some(libc::ECHILD) => break,
                Some(libc::EINTR) => continue,
                _ => return Err(error),
            }
        }
    }
    Ok(reaped)
}

#[cfg(not(unix))]
fn reap_cgroup_member_children(_: &[i32]) -> io::Result<usize> {
    Ok(0)
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

fn memory_swap_max(memory_swap_max_bytes: u64) -> String {
    memory_swap_max_bytes.to_string()
}

fn pids_max(pids_max: u64) -> String {
    if pids_max == 0 {
        "max".to_owned()
    } else {
        pids_max.to_string()
    }
}

struct ChildSetup<'a> {
    options: ChildSetupOptions,
    cgroup_procs_path: &'a Path,
    rootfs: Option<&'a Path>,
    workspace_host: &'a Path,
    guest_cwd: &'a Path,
}

#[derive(Clone, Copy)]
struct ChildSetupOptions {
    child_uid: u32,
    child_gid: u32,
    require_private_namespaces: bool,
    enable_seccomp: bool,
    child_rlimits: ChildRlimits,
    seccomp_profile: SeccompProfile,
}

struct ChildSetupPaths {
    cgroup_procs_path: CString,
    rootfs: Option<CString>,
    workspace_host: CString,
    guest_cwd: CString,
}

fn install_child_setup(command: &mut Command, setup: ChildSetup<'_>) -> Result<(), RunnerError> {
    let options = setup.options;
    let paths = ChildSetupPaths {
        cgroup_procs_path: cstring_path(setup.cgroup_procs_path)?,
        rootfs: setup.rootfs.map(cstring_path).transpose()?,
        workspace_host: cstring_path(setup.workspace_host)?,
        guest_cwd: cstring_path(setup.guest_cwd)?,
    };
    unsafe {
        command.pre_exec(move || configure_child_process(options, &paths));
    }
    Ok(())
}

fn configure_child_process(options: ChildSetupOptions, paths: &ChildSetupPaths) -> io::Result<()> {
    unsafe {
        move_current_process_to_cgroup(&paths.cgroup_procs_path)?;
        if options.require_private_namespaces {
            let flags =
                libc::CLONE_NEWNS | libc::CLONE_NEWIPC | libc::CLONE_NEWUTS | libc::CLONE_NEWNET;
            if libc::unshare(flags) != 0 {
                return Err(io::Error::last_os_error());
            }
            if libc::mount(
                std::ptr::null::<libc::c_char>(),
                c"/".as_ptr(),
                std::ptr::null::<libc::c_char>(),
                (libc::MS_REC | libc::MS_PRIVATE) as libc::c_ulong,
                std::ptr::null::<libc::c_void>(),
            ) != 0
            {
                return Err(io::Error::last_os_error());
            }
        }
        if let Some(rootfs) = paths.rootfs.as_deref() {
            setup_rootfs(rootfs, &paths.workspace_host)?;
            if libc::chdir(paths.guest_cwd.as_ptr()) != 0 {
                return Err(io::Error::last_os_error());
            }
        }
        if libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0 {
            return Err(io::Error::last_os_error());
        }
        if libc::setsid() < 0 {
            return Err(io::Error::last_os_error());
        }
        apply_child_rlimits(options.child_rlimits)?;
        if libc::geteuid() == 0 {
            if libc::setgroups(0, std::ptr::null()) != 0 {
                return Err(io::Error::last_os_error());
            }
            if libc::setgid(options.child_gid as libc::gid_t) != 0 {
                return Err(io::Error::last_os_error());
            }
            if libc::setuid(options.child_uid as libc::uid_t) != 0 {
                return Err(io::Error::last_os_error());
            }
        }
        if options.enable_seccomp {
            install_seccomp_denylist(options.seccomp_profile)?;
        }
        close_inherited_fds()?;
    }
    Ok(())
}

fn apply_child_rlimits(limits: ChildRlimits) -> io::Result<()> {
    if let Some(cpu_seconds) = limits.cpu_seconds {
        set_cpu_rlimit(cpu_seconds)?;
    }
    set_rlimit(libc::RLIMIT_CORE, limits.core_bytes)?;
    set_rlimit(libc::RLIMIT_FSIZE, limits.file_size_bytes)?;
    set_rlimit(libc::RLIMIT_NOFILE, limits.nofile)?;
    set_rlimit(libc::RLIMIT_NPROC, limits.nproc)?;
    set_rlimit(libc::RLIMIT_STACK, limits.stack_bytes)?;
    set_rlimit(libc::RLIMIT_MEMLOCK, limits.memlock_bytes)?;
    Ok(())
}

fn setup_rootfs(rootfs: &CStr, workspace_host: &CStr) -> io::Result<()> {
    unsafe {
        let old_root = CString::new(format!("/{OLD_ROOT_NAME}"))
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "invalid old root path"))?;
        let old_root_relative = CString::new(OLD_ROOT_NAME).map_err(|_| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "invalid old root relative path",
            )
        })?;

        mkdirat_path(rootfs, c"/workspace")?;
        mkdirat_path(rootfs, c"/tmp")?;
        mkdirat_path(rootfs, c"/proc")?;
        mkdirat_path(rootfs, c"/dev")?;
        mkdirat_path(rootfs, EMPTY_MASK_DIR)?;
        mkdirat_path(rootfs, old_root.as_c_str())?;

        mount_bind(rootfs, rootfs, true)?;
        remount_readonly(rootfs)?;

        let workspace_guest = join_cstr_path(rootfs, c"/workspace")?;
        mount_bind(workspace_host, workspace_guest.as_c_str(), true)?;

        let tmp_guest = join_cstr_path(rootfs, c"/tmp")?;
        mount_tmpfs(tmp_guest.as_c_str())?;

        let proc_guest = join_cstr_path(rootfs, c"/proc")?;
        mount_proc(proc_guest.as_c_str())?;

        let dev_guest = join_cstr_path(rootfs, c"/dev")?;
        mount_minimal_dev(dev_guest.as_c_str())?;
        mask_sensitive_proc_paths(rootfs)?;

        if libc::chdir(rootfs.as_ptr()) != 0 {
            return Err(io::Error::last_os_error());
        }
        if libc::syscall(
            libc::SYS_pivot_root,
            c".".as_ptr(),
            old_root_relative.as_ptr(),
        ) != 0
        {
            return Err(io::Error::last_os_error());
        }
        if libc::chdir(c"/".as_ptr()) != 0 {
            return Err(io::Error::last_os_error());
        }
        if libc::umount2(old_root.as_ptr(), libc::MNT_DETACH) != 0 {
            return Err(io::Error::last_os_error());
        }
        if libc::rmdir(old_root.as_ptr()) != 0 {
            return Err(io::Error::last_os_error());
        }
    }
    Ok(())
}

fn mkdirat_path(root: &CStr, child: &CStr) -> io::Result<()> {
    let path = join_cstr_path(root, child)?;
    unsafe {
        if libc::mkdir(path.as_ptr(), 0o755) != 0 {
            let error = io::Error::last_os_error();
            if error.raw_os_error() != Some(libc::EEXIST) {
                return Err(error);
            }
        }
    }
    Ok(())
}

fn mount_bind(source: &CStr, target: &CStr, recursive: bool) -> io::Result<()> {
    let flags = if recursive {
        libc::MS_BIND | libc::MS_REC
    } else {
        libc::MS_BIND
    };
    mount(source, target, None, flags as libc::c_ulong, None)
}

fn remount_readonly(target: &CStr) -> io::Result<()> {
    mount(
        target,
        target,
        None,
        (libc::MS_BIND | libc::MS_REMOUNT | libc::MS_RDONLY | libc::MS_REC) as libc::c_ulong,
        None,
    )
}

fn mount_tmpfs(target: &CStr) -> io::Result<()> {
    mount(
        c"tmpfs",
        target,
        Some(c"tmpfs"),
        (libc::MS_NOSUID | libc::MS_NODEV) as libc::c_ulong,
        Some(c"mode=1777,size=64m"),
    )
}

fn mount_proc(target: &CStr) -> io::Result<()> {
    mount(
        c"proc",
        target,
        Some(c"proc"),
        (libc::MS_NOSUID | libc::MS_NOEXEC | libc::MS_NODEV | libc::MS_RDONLY) as libc::c_ulong,
        None,
    )
}

const MASKED_PROC_FILES: [&CStr; 18] = [
    c"/proc/buddyinfo",
    c"/proc/interrupts",
    c"/proc/iomem",
    c"/proc/ioports",
    c"/proc/kallsyms",
    c"/proc/kcore",
    c"/proc/keys",
    c"/proc/kmsg",
    c"/proc/latency_stats",
    c"/proc/modules",
    c"/proc/pagetypeinfo",
    c"/proc/sched_debug",
    c"/proc/slabinfo",
    c"/proc/sysrq-trigger",
    c"/proc/timer_list",
    c"/proc/timer_stats",
    c"/proc/vmallocinfo",
    c"/proc/zoneinfo",
];

const MASKED_PROC_DIRECTORIES: [&CStr; 9] = [
    c"/proc/acpi",
    c"/proc/asound",
    c"/proc/bus",
    c"/proc/driver",
    c"/proc/fs",
    c"/proc/irq",
    c"/proc/scsi",
    c"/proc/sys",
    c"/proc/sysvipc",
];

const MINIMAL_DEV_NODES: [(&CStr, u64, u64); 4] = [
    (c"null", 1, 3),
    (c"zero", 1, 5),
    (c"random", 1, 8),
    (c"urandom", 1, 9),
];

fn mount_minimal_dev(target: &CStr) -> io::Result<()> {
    mount(
        c"tmpfs",
        target,
        Some(c"tmpfs"),
        (libc::MS_NOSUID | libc::MS_NOEXEC) as libc::c_ulong,
        Some(c"mode=755,size=64k"),
    )?;
    for (name, major, minor) in MINIMAL_DEV_NODES {
        create_char_device(target, name, major, minor)?;
    }
    Ok(())
}

fn mask_sensitive_proc_paths(rootfs: &CStr) -> io::Result<()> {
    let dev_null = join_cstr_path(rootfs, c"/dev/null")?;
    for path in MASKED_PROC_FILES {
        let target = join_cstr_path(rootfs, path)?;
        if c_path_exists(target.as_c_str()) {
            mount_bind(dev_null.as_c_str(), target.as_c_str(), false)?;
        }
    }
    let empty_dir = join_cstr_path(rootfs, EMPTY_MASK_DIR)?;
    for path in MASKED_PROC_DIRECTORIES {
        let target = join_cstr_path(rootfs, path)?;
        if c_path_is_directory(target.as_c_str()) {
            mount_bind(empty_dir.as_c_str(), target.as_c_str(), false)?;
            remount_readonly(target.as_c_str())?;
        }
    }
    Ok(())
}

fn c_path_exists(path: &CStr) -> bool {
    unsafe { libc::access(path.as_ptr(), libc::F_OK) == 0 }
}

fn c_path_is_directory(path: &CStr) -> bool {
    let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
    let result = unsafe { libc::stat(path.as_ptr(), stat.as_mut_ptr()) };
    if result != 0 {
        return false;
    }
    let mode = unsafe { stat.assume_init().st_mode };
    (mode & libc::S_IFMT) == libc::S_IFDIR
}

fn create_char_device(parent: &CStr, name: &CStr, major: u64, minor: u64) -> io::Result<()> {
    let path = join_cstr_path(parent, name)?;
    let mode = (libc::S_IFCHR | 0o666) as libc::mode_t;
    let result = unsafe { libc::mknod(path.as_ptr(), mode, linux_makedev(major, minor)) };
    if result == 0 {
        Ok(())
    } else {
        let error = io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::EEXIST) {
            Ok(())
        } else {
            Err(error)
        }
    }
}

fn linux_makedev(major: u64, minor: u64) -> libc::dev_t {
    ((minor & 0xff) | ((major & 0xfff) << 8) | ((minor & !0xff) << 12) | ((major & !0xfff) << 32))
        as libc::dev_t
}

fn mount(
    source: &CStr,
    target: &CStr,
    filesystemtype: Option<&CStr>,
    flags: libc::c_ulong,
    data: Option<&CStr>,
) -> io::Result<()> {
    let result = unsafe {
        libc::mount(
            source.as_ptr(),
            target.as_ptr(),
            filesystemtype.map_or(std::ptr::null(), CStr::as_ptr),
            flags,
            data.map_or(std::ptr::null(), |value| value.as_ptr().cast()),
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

fn close_inherited_fds() -> io::Result<()> {
    let result =
        unsafe { libc::close_range(3, u32::MAX, libc::CLOSE_RANGE_UNSHARE as libc::c_int) };
    if result == 0 {
        return Ok(());
    }

    let error = io::Error::last_os_error();
    if !matches!(error.raw_os_error(), Some(libc::ENOSYS | libc::EINVAL)) {
        return Err(error);
    }
    close_inherited_fds_via_proc()
}

fn close_inherited_fds_via_proc() -> io::Result<()> {
    let mut fds = Vec::new();
    let entries = fs::read_dir("/proc/self/fd")?;
    for entry in entries {
        let entry = entry?;
        let Some(fd) = entry
            .file_name()
            .to_str()
            .and_then(|name| name.parse::<i32>().ok())
        else {
            continue;
        };
        if fd <= 2 {
            continue;
        }
        fds.push(fd);
    }
    for fd in fds {
        unsafe {
            libc::close(fd);
        }
    }
    Ok(())
}

fn install_seccomp_denylist(profile: SeccompProfile) -> io::Result<()> {
    let mut instructions = seccomp_filter_instructions(profile);
    let mut program = libc::sock_fprog {
        len: instructions
            .len()
            .try_into()
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "seccomp filter too long"))?,
        filter: instructions.as_mut_ptr(),
    };

    let result = unsafe {
        libc::prctl(
            libc::PR_SET_SECCOMP,
            libc::SECCOMP_MODE_FILTER,
            &mut program as *mut libc::sock_fprog,
            0,
            0,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

fn seccomp_filter_instructions(profile: SeccompProfile) -> Vec<libc::sock_filter> {
    let denied_syscalls = seccomp_denied_syscalls(profile);
    let mut instructions = Vec::with_capacity(denied_syscalls.len() * 2 + 5);
    instructions.push(bpf_stmt(
        (libc::BPF_LD | libc::BPF_W | libc::BPF_ABS) as u16,
        SECCOMP_DATA_ARCH_OFFSET,
    ));
    instructions.push(bpf_jump(
        (libc::BPF_JMP | libc::BPF_JEQ | libc::BPF_K) as u16,
        audit_arch(),
        1,
        0,
    ));
    instructions.push(seccomp_ret(libc::SECCOMP_RET_KILL_PROCESS));
    instructions.push(bpf_stmt(
        (libc::BPF_LD | libc::BPF_W | libc::BPF_ABS) as u16,
        SECCOMP_DATA_NR_OFFSET,
    ));
    for syscall in denied_syscalls {
        instructions.push(bpf_jump(
            (libc::BPF_JMP | libc::BPF_JEQ | libc::BPF_K) as u16,
            syscall as u32,
            0,
            1,
        ));
        instructions.push(seccomp_ret(seccomp_syscall_action(syscall)));
    }
    instructions.push(seccomp_ret(libc::SECCOMP_RET_ALLOW));
    instructions
}

fn seccomp_ret(action: u32) -> libc::sock_filter {
    bpf_stmt((libc::BPF_RET | libc::BPF_K) as u16, action)
}

fn seccomp_syscall_action(syscall: libc::c_long) -> u32 {
    if syscall == libc::SYS_clone3 {
        return seccomp_errno(libc::ENOSYS);
    }
    seccomp_errno(libc::EPERM)
}

fn seccomp_errno(errno: i32) -> u32 {
    libc::SECCOMP_RET_ERRNO | ((errno as u32) & SECCOMP_RET_DATA_MASK)
}

fn bpf_stmt(code: u16, k: u32) -> libc::sock_filter {
    unsafe { libc::BPF_STMT(code, k) }
}

fn bpf_jump(code: u16, k: u32, jt: u8, jf: u8) -> libc::sock_filter {
    unsafe { libc::BPF_JUMP(code, k, jt, jf) }
}

fn seccomp_denied_syscalls(profile: SeccompProfile) -> Vec<libc::c_long> {
    let mut denied = BASE_SECCOMP_DENIED_SYSCALLS.to_vec();
    if profile == SeccompProfile::Run {
        denied.extend_from_slice(RUN_SECCOMP_EXTRA_DENIED_SYSCALLS);
    }
    denied.sort_unstable();
    denied.dedup();
    denied
}

#[cfg(target_arch = "x86_64")]
fn audit_arch() -> u32 {
    AUDIT_ARCH_X86_64
}

#[cfg(target_arch = "aarch64")]
fn audit_arch() -> u32 {
    AUDIT_ARCH_AARCH64
}

#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
fn audit_arch() -> u32 {
    0
}

const SECCOMP_DATA_NR_OFFSET: u32 = 0;
const SECCOMP_DATA_ARCH_OFFSET: u32 = 4;
const SECCOMP_RET_DATA_MASK: u32 = 0x0000ffff;
#[cfg(target_arch = "x86_64")]
const AUDIT_ARCH_X86_64: u32 = 0xc000003e;
#[cfg(target_arch = "aarch64")]
const AUDIT_ARCH_AARCH64: u32 = 0xc00000b7;

#[rustfmt::skip]
const BASE_SECCOMP_DENIED_SYSCALLS: &[libc::c_long] = &[
    libc::SYS_socket,
    libc::SYS_bind,
    libc::SYS_listen,
    libc::SYS_accept,
    libc::SYS_accept4,
    libc::SYS_connect,
    libc::SYS_sendto,
    libc::SYS_recvfrom,
    libc::SYS_sendmsg,
    libc::SYS_recvmsg,
    libc::SYS_shutdown,
    libc::SYS_setsockopt,
    libc::SYS_getsockopt,
    libc::SYS_recvmmsg,
    libc::SYS_sendmmsg,
    libc::SYS_mount,
    libc::SYS_umount2,
    libc::SYS_fsopen,
    libc::SYS_fsconfig,
    libc::SYS_fsmount,
    libc::SYS_fspick,
    libc::SYS_open_tree,
    libc::SYS_move_mount,
    libc::SYS_mount_setattr,
    libc::SYS_pivot_root,
    libc::SYS_chroot,
    libc::SYS_mknod,
    libc::SYS_mknodat,
    libc::SYS_unshare,
    libc::SYS_setns,
    libc::SYS_clone3,
    libc::SYS_ptrace,
    libc::SYS_process_vm_readv,
    libc::SYS_process_vm_writev,
    libc::SYS_bpf,
    libc::SYS_perf_event_open,
    libc::SYS_fanotify_init,
    libc::SYS_fanotify_mark,
    libc::SYS_name_to_handle_at,
    libc::SYS_open_by_handle_at,
    libc::SYS_keyctl,
    libc::SYS_add_key,
    libc::SYS_request_key,
    libc::SYS_reboot,
    libc::SYS_kexec_load,
    libc::SYS_kexec_file_load,
    libc::SYS_sethostname,
    libc::SYS_setdomainname,
    libc::SYS_swapon,
    libc::SYS_swapoff,
    libc::SYS_init_module,
    libc::SYS_finit_module,
    libc::SYS_delete_module,
    libc::SYS_userfaultfd,
    libc::SYS_io_uring_setup,
    libc::SYS_io_uring_enter,
    libc::SYS_io_uring_register,
    libc::SYS_quotactl,
    libc::SYS_quotactl_fd,
    libc::SYS_acct,
];

#[rustfmt::skip]
const RUN_SECCOMP_EXTRA_DENIED_SYSCALLS: &[libc::c_long] = &[
    libc::SYS_chmod,
    libc::SYS_fchmod,
    libc::SYS_fchmodat,
    libc::SYS_chown,
    libc::SYS_fchown,
    libc::SYS_lchown,
    libc::SYS_fchownat,
    libc::SYS_setxattr,
    libc::SYS_lsetxattr,
    libc::SYS_fsetxattr,
    libc::SYS_removexattr,
    libc::SYS_lremovexattr,
    libc::SYS_fremovexattr,
    libc::SYS_clock_settime,
    libc::SYS_settimeofday,
    libc::SYS_adjtimex,
];

fn set_rlimit(resource: libc::__rlimit_resource_t, value: u64) -> io::Result<()> {
    let value = rlimit_value(value);
    let limit = libc::rlimit {
        rlim_cur: value,
        rlim_max: value,
    };
    let result = unsafe { libc::setrlimit(resource, &limit) };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

fn set_cpu_rlimit(soft_seconds: u64) -> io::Result<()> {
    let hard_seconds = soft_seconds.saturating_add(1);
    let limit = libc::rlimit {
        rlim_cur: rlimit_value(soft_seconds),
        rlim_max: rlimit_value(hard_seconds),
    };
    let result = unsafe { libc::setrlimit(libc::RLIMIT_CPU, &limit) };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

fn rlimit_value(value: u64) -> libc::rlim_t {
    libc::rlim_t::try_from(value).unwrap_or(libc::RLIM_INFINITY)
}

fn cstring_path(path: &Path) -> Result<CString, RunnerError> {
    CString::new(path.as_os_str().as_bytes())
        .map_err(|_| RunnerError::System(format!("path contains nul byte: {:?}", path)))
}

fn join_cstr_path(root: &CStr, child: &CStr) -> io::Result<CString> {
    let root_bytes = root.to_bytes();
    let child_bytes = child.to_bytes();
    let mut output = Vec::with_capacity(root_bytes.len() + child_bytes.len() + 1);
    output.extend_from_slice(root_bytes);
    if !root_bytes.ends_with(b"/") && !child_bytes.starts_with(b"/") {
        output.push(b'/');
    }
    if root_bytes.ends_with(b"/") && child_bytes.starts_with(b"/") {
        output.extend_from_slice(&child_bytes[1..]);
    } else {
        output.extend_from_slice(child_bytes);
    }
    CString::new(output).map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "nul in path"))
}

fn move_current_process_to_cgroup(cgroup_procs_path: &CStr) -> io::Result<()> {
    unsafe {
        let fd = libc::open(cgroup_procs_path.as_ptr(), libc::O_WRONLY | libc::O_CLOEXEC);
        if fd < 0 {
            return Err(io::Error::last_os_error());
        }

        let pid = libc::getpid();
        let write_result = write_pid(fd, pid);
        let close_result = libc::close(fd);
        write_result?;
        if close_result != 0 {
            return Err(io::Error::last_os_error());
        }
    }
    Ok(())
}

fn write_pid(fd: libc::c_int, pid: libc::pid_t) -> io::Result<()> {
    if pid <= 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "pid must be positive",
        ));
    }

    let mut value = pid as u32;
    let mut buffer = [0u8; 16];
    let mut index = buffer.len();
    index -= 1;
    buffer[index] = b'\n';
    while value > 0 {
        index -= 1;
        buffer[index] = b'0' + (value % 10) as u8;
        value /= 10;
    }

    let bytes = &buffer[index..];
    let written = unsafe { libc::write(fd, bytes.as_ptr().cast(), bytes.len()) };
    if written == bytes.len() as isize {
        Ok(())
    } else if written < 0 {
        Err(io::Error::last_os_error())
    } else {
        Err(io::Error::new(
            io::ErrorKind::WriteZero,
            "short write to cgroup.procs",
        ))
    }
}

fn env_u32(name: &str, fallback: u32) -> Result<u32, RunnerError> {
    match std::env::var(name) {
        Ok(value) => value
            .parse::<u32>()
            .map_err(|_| RunnerError::Preflight(format!("{name} must be a u32, got {value:?}"))),
        Err(_) => Ok(fallback),
    }
}

fn env_u64(name: &str, fallback: u64) -> Result<u64, RunnerError> {
    match std::env::var(name) {
        Ok(value) => value
            .parse::<u64>()
            .map_err(|_| RunnerError::Preflight(format!("{name} must be a u64, got {value:?}"))),
        Err(_) => Ok(fallback),
    }
}

fn optional_env_u64(name: &str) -> Result<Option<u64>, RunnerError> {
    match std::env::var(name) {
        Ok(value) => value
            .parse::<u64>()
            .map(Some)
            .map_err(|_| RunnerError::Preflight(format!("{name} must be a u64, got {value:?}"))),
        Err(_) => Ok(None),
    }
}

fn optional_nonzero_env_u64(name: &str) -> Result<Option<u64>, RunnerError> {
    optional_env_u64(name).map(|value| value.filter(|value| *value > 0))
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IsolationIntent {
    pub command: String,
    pub seccomp_profile: SeccompProfile,
    pub requires_private_mount_namespace: bool,
    pub requires_private_ipc_namespace: bool,
    pub requires_private_uts_namespace: bool,
    pub requires_private_network_namespace: bool,
    pub enforces_no_new_privs: bool,
    pub drops_to_unprivileged_uid_gid: bool,
    pub enforces_cgroup_limits: bool,
    pub enforces_rlimits: bool,
}

impl IsolationIntent {
    pub fn for_plan(plan: &CommandPlan) -> Self {
        Self {
            command: plan.display_command(),
            seccomp_profile: plan.seccomp_profile,
            requires_private_mount_namespace: true,
            requires_private_ipc_namespace: true,
            requires_private_uts_namespace: true,
            requires_private_network_namespace: true,
            enforces_no_new_privs: true,
            drops_to_unprivileged_uid_gid: true,
            enforces_cgroup_limits: plan.memory_limit_bytes > 0,
            enforces_rlimits: true,
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
    #[error("rootfs requires private mount namespace isolation")]
    RootfsRequiresMountNamespace,
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

    #[tokio::test]
    async fn applies_nofile_rlimit() {
        let plan = shell_plan("ulimit -n", 1024);

        let result = execute_command_without_cgroup(&plan)
            .await
            .expect("command runs");

        assert_eq!(&result.stdout[..], b"1024\n");
    }

    #[tokio::test]
    async fn cancels_running_command() {
        let mut plan = shell_plan("sleep 5", 1024);
        plan.timeout = Duration::from_secs(10);
        let cgroup_root = tempfile::tempdir().expect("tempdir");
        let config = SandboxConfig {
            require_private_namespaces: false,
            cgroup_root: cgroup_root.path().to_path_buf(),
            ..Default::default()
        };
        seed_fake_cgroup(&config.cgroup_root);
        let (cancel_tx, mut cancel_rx) = tokio::sync::watch::channel(false);

        let task =
            tokio::spawn(async move { execute_command(&plan, &config, &mut cancel_rx).await });
        tokio::time::sleep(Duration::from_millis(20)).await;
        cancel_tx.send(true).expect("send cancel");

        let err = task
            .await
            .expect("task joins")
            .expect_err("command is canceled");
        assert!(matches!(err, RunnerError::Canceled(_)));
    }

    #[tokio::test]
    async fn closes_inherited_file_descriptors() {
        let leaked = tempfile::NamedTempFile::new().expect("temp file");
        clear_cloexec(leaked.as_file());
        let leaked_path = leaked.path().to_string_lossy().into_owned();
        let plan = shell_plan("ls -l /proc/self/fd", 4096);

        let result = execute_command_without_cgroup(&plan)
            .await
            .expect("command runs");
        let stdout = String::from_utf8_lossy(&result.stdout);

        assert!(
            !stdout.contains(&leaked_path),
            "child inherited fd for {leaked_path}: {stdout}"
        );
    }

    #[tokio::test]
    async fn denies_socket_syscall_with_seccomp() {
        let Some(python) = python3_path() else {
            return;
        };
        let mut plan = shell_plan("", 1024);
        plan.program = python;
        plan.args = vec![
            "-c".to_owned(),
            "import socket; socket.socket(socket.AF_INET, socket.SOCK_STREAM)".to_owned(),
        ];

        let result = execute_command_without_cgroup(&plan)
            .await
            .expect("seccomp should deny socket and produce result");

        assert_ne!(result.exit_code, Some(0));
        assert_eq!(result.signal, None);
        assert!(
            String::from_utf8_lossy(&result.stderr).contains("PermissionError"),
            "socket denial should surface as EPERM: {:?}",
            String::from_utf8_lossy(&result.stderr)
        );
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
        assert!(intent.enforces_cgroup_limits);
        assert!(intent.enforces_rlimits);
        assert_eq!(intent.seccomp_profile, SeccompProfile::Run);
    }

    #[test]
    fn seccomp_denylist_blocks_network_and_kernel_escape_syscalls() {
        let denied = seccomp_denied_syscalls(SeccompProfile::Compile);

        assert!(denied.contains(&libc::SYS_socket));
        assert!(!denied.contains(&libc::SYS_socketpair));
        assert!(denied.contains(&libc::SYS_connect));
        assert!(denied.contains(&libc::SYS_mount));
        assert!(denied.contains(&libc::SYS_open_tree));
        assert!(denied.contains(&libc::SYS_clone3));
        assert!(denied.contains(&libc::SYS_bpf));
        assert!(denied.contains(&libc::SYS_ptrace));
        assert!(denied.contains(&libc::SYS_process_vm_readv));
        assert!(denied.contains(&libc::SYS_io_uring_setup));
        assert!(denied.contains(&libc::SYS_io_uring_enter));
        assert!(denied.contains(&libc::SYS_name_to_handle_at));
        assert!(denied.contains(&libc::SYS_open_by_handle_at));
        let instructions = seccomp_filter_instructions(SeccompProfile::Compile);
        assert_eq!(instructions[0].k, SECCOMP_DATA_ARCH_OFFSET);
        assert_eq!(instructions[1].k, audit_arch());
        assert_eq!(
            instructions[2].k,
            libc::SECCOMP_RET_KILL_PROCESS,
            "unexpected arch must be killed"
        );
        assert_eq!(instructions[3].k, SECCOMP_DATA_NR_OFFSET);
        assert_eq!(
            instructions.last().map(|filter| filter.k),
            Some(libc::SECCOMP_RET_ALLOW)
        );
        assert_eq!(
            seccomp_syscall_action(libc::SYS_socket),
            seccomp_errno(libc::EPERM)
        );
        assert_eq!(
            seccomp_syscall_action(libc::SYS_clone3),
            seccomp_errno(libc::ENOSYS)
        );
    }

    #[test]
    fn run_seccomp_profile_adds_metadata_mutation_denies() {
        let compile = seccomp_denied_syscalls(SeccompProfile::Compile);
        let run = seccomp_denied_syscalls(SeccompProfile::Run);

        assert!(!compile.contains(&libc::SYS_chmod));
        assert!(run.contains(&libc::SYS_chmod));
        assert!(run.contains(&libc::SYS_fchownat));
        assert!(run.contains(&libc::SYS_setxattr));
        assert!(run.contains(&libc::SYS_clock_settime));
    }

    #[test]
    fn prepares_runner_cgroup_and_enables_controllers() {
        let root = tempfile::tempdir().expect("tempdir");
        let parent = root.path().join(RUNNER_CGROUP_NAME);
        fs::create_dir_all(&parent).expect("parent cgroup");
        fs::write(parent.join("cgroup.controllers"), "cpu memory pids io").expect("controllers");
        fs::write(parent.join("cgroup.subtree_control"), "").expect("subtree control");

        let parent = ensure_runner_cgroup(root.path()).expect("runner cgroup");

        assert_eq!(parent, root.path().join(RUNNER_CGROUP_NAME));
        assert_eq!(
            fs::read_to_string(parent.join("cgroup.subtree_control")).expect("subtree control"),
            "+cpu +memory +pids"
        );
    }

    #[test]
    fn reads_memory_peak_from_cgroup() {
        let root = tempfile::tempdir().expect("tempdir");
        fs::write(root.path().join("memory.peak"), "12345\n").expect("memory peak");
        let cgroup = CgroupGuard {
            path: root.path().to_path_buf(),
            procs_path: root.path().join("cgroup.procs"),
            supports_kernel_kill: false,
        };

        assert_eq!(cgroup.memory_peak_bytes(), 12345);
    }

    #[test]
    fn reads_cgroup_stats() {
        let root = tempfile::tempdir().expect("tempdir");
        fs::write(root.path().join("memory.peak"), "12345\n").expect("memory peak");
        fs::write(
            root.path().join("memory.events"),
            "low 0\nhigh 1\noom 2\noom_kill 3\n",
        )
        .expect("memory events");
        fs::write(
            root.path().join("cpu.stat"),
            "usage_usec 44\nuser_usec 30\nsystem_usec 14\nnr_throttled 2\nthrottled_usec 55\n",
        )
        .expect("cpu stat");
        fs::write(root.path().join("pids.peak"), "9\n").expect("pids peak");
        let cgroup = CgroupGuard {
            path: root.path().to_path_buf(),
            procs_path: root.path().join("cgroup.procs"),
            supports_kernel_kill: false,
        };

        let stats = cgroup.stats();

        assert_eq!(
            stats,
            CgroupStats {
                memory_peak_bytes: 12345,
                memory_oom_kill_count: 3,
                cpu_usage_usec: 44,
                cpu_throttled_usec: 55,
                pids_peak: 9
            }
        );
    }

    #[test]
    fn kill_all_writes_cgroup_kill() {
        let root = tempfile::tempdir().expect("tempdir");
        fs::write(root.path().join("cgroup.procs"), "").expect("cgroup procs");
        let cgroup = CgroupGuard {
            path: root.path().to_path_buf(),
            procs_path: root.path().join("cgroup.procs"),
            supports_kernel_kill: false,
        };

        cgroup.kill_all();

        assert_eq!(
            fs::read_to_string(root.path().join("cgroup.kill")).expect("cgroup kill"),
            "1"
        );
    }

    #[tokio::test]
    async fn kill_all_waits_for_empty_cgroup() {
        let root = tempfile::tempdir().expect("tempdir");
        fs::write(root.path().join("cgroup.kill"), "").expect("cgroup kill");
        fs::write(root.path().join("cgroup.procs"), "\n").expect("cgroup procs");
        let cgroup = CgroupGuard {
            path: root.path().to_path_buf(),
            procs_path: root.path().join("cgroup.procs"),
            supports_kernel_kill: true,
        };

        cgroup
            .kill_all_and_wait_empty()
            .await
            .expect("empty cgroup is confirmed");

        assert_eq!(
            fs::read_to_string(root.path().join("cgroup.kill")).expect("cgroup kill"),
            "1"
        );
    }

    #[test]
    fn parses_cgroup_member_pids() {
        let root = tempfile::tempdir().expect("tempdir");
        fs::write(root.path().join("cgroup.procs"), "12\n\n34\n").expect("cgroup procs");
        let cgroup = CgroupGuard {
            path: root.path().to_path_buf(),
            procs_path: root.path().join("cgroup.procs"),
            supports_kernel_kill: false,
        };

        assert_eq!(cgroup.member_pids().expect("member pids"), vec![12, 34]);
    }

    #[test]
    fn prepares_command_cgroup_before_spawn() {
        let root = tempfile::tempdir().expect("tempdir");
        seed_fake_cgroup(root.path());
        let config = SandboxConfig {
            cgroup_root: root.path().to_path_buf(),
            pids_max: 23,
            memory_swap_max_bytes: Some(0),
            ..Default::default()
        };
        let plan = shell_plan("true", 1024);

        let cgroup = CgroupGuard::prepare(&config, &plan).expect("command cgroup");

        assert!(cgroup
            .path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with(&format!("laeufer-{}-", std::process::id()))));
        assert_eq!(
            fs::read_to_string(cgroup.path.join("memory.max")).expect("memory max"),
            "134217728"
        );
        assert_eq!(
            fs::read_to_string(cgroup.path.join("memory.oom.group")).expect("memory oom group"),
            "1"
        );
        assert_eq!(
            fs::read_to_string(cgroup.path.join("memory.swap.max")).expect("memory swap max"),
            "0"
        );
        assert_eq!(
            fs::read_to_string(cgroup.path.join("pids.max")).expect("pids max"),
            "23"
        );
        assert_eq!(
            fs::read_to_string(cgroup.path.join("cpu.max")).expect("cpu max"),
            "100000 100000"
        );
        assert_eq!(cgroup.procs_path(), cgroup.path.join("cgroup.procs"));
    }

    #[test]
    fn pids_zero_means_unlimited() {
        assert_eq!(pids_max(0), "max");
        assert_eq!(pids_max(64), "64");
    }

    #[test]
    fn rootfs_execution_plan_rewrites_host_workspace_paths() {
        let workspace = PathBuf::from("/runner/jobs/job-1/src");
        let plan = CommandPlan {
            program: "/usr/bin/go".to_owned(),
            args: vec![
                "build".to_owned(),
                "-o".to_owned(),
                "/runner/jobs/job-1/src/.laeufer-bin/main".to_owned(),
                "/runner/jobs/job-1/src".to_owned(),
            ],
            env: vec![
                (
                    "GOCACHE".to_owned(),
                    "/runner/jobs/job-1/src/.laeufer-cache".to_owned(),
                ),
                ("PATH".to_owned(), "/usr/bin:/bin".to_owned()),
            ],
            cwd: workspace.clone(),
            stdin: Default::default(),
            timeout: Duration::from_secs(1),
            memory_limit_bytes: 128 * 1024 * 1024,
            cpu_millis: 1000,
            max_output_bytes: 1024,
            seccomp_profile: SeccompProfile::Compile,
        };

        let execution = execution_plan_for_rootfs(&plan, true);

        assert_eq!(execution.host_cwd, workspace);
        assert_eq!(
            execution.workspace_host,
            PathBuf::from("/runner/jobs/job-1/src")
        );
        assert_eq!(execution.plan.cwd, PathBuf::from(GUEST_WORKSPACE));
        assert_eq!(
            execution.plan.args,
            vec!["build", "-o", "/workspace/.laeufer-bin/main", "/workspace"]
        );
        assert_eq!(
            execution.plan.env,
            vec![
                ("GOCACHE".to_owned(), "/workspace/.laeufer-cache".to_owned()),
                ("PATH".to_owned(), "/usr/bin:/bin".to_owned())
            ]
        );
    }

    #[test]
    fn rootfs_preflight_requires_private_namespaces() {
        let rootfs = tempfile::tempdir().expect("rootfs");
        let mut config = sandbox_config_without_namespaces();
        config.rootfs = Some(rootfs.path().to_path_buf());

        let err = preflight(&config).expect_err("rootfs needs mount namespace");

        assert!(matches!(err, SandboxError::RootfsRequiresMountNamespace));
    }

    #[test]
    fn minimal_dev_nodes_are_limited_to_basic_character_devices() {
        let nodes: Vec<_> = MINIMAL_DEV_NODES
            .iter()
            .map(|(name, major, minor)| {
                (
                    name.to_string_lossy().into_owned(),
                    linux_makedev(*major, *minor) as u64,
                )
            })
            .collect();

        assert_eq!(
            nodes,
            vec![
                ("null".to_owned(), 259),
                ("zero".to_owned(), 261),
                ("random".to_owned(), 264),
                ("urandom".to_owned(), 265),
            ]
        );
    }

    #[test]
    fn masks_only_sensitive_proc_files() {
        let paths: Vec<_> = MASKED_PROC_FILES
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect();

        assert_eq!(
            paths,
            vec![
                "/proc/buddyinfo",
                "/proc/interrupts",
                "/proc/iomem",
                "/proc/ioports",
                "/proc/kallsyms",
                "/proc/kcore",
                "/proc/keys",
                "/proc/kmsg",
                "/proc/latency_stats",
                "/proc/modules",
                "/proc/pagetypeinfo",
                "/proc/sched_debug",
                "/proc/slabinfo",
                "/proc/sysrq-trigger",
                "/proc/timer_list",
                "/proc/timer_stats",
                "/proc/vmallocinfo",
                "/proc/zoneinfo",
            ]
        );
    }

    #[test]
    fn masks_sensitive_proc_directories_with_empty_source() {
        assert_eq!(EMPTY_MASK_DIR.to_string_lossy(), "/.sandkasten-empty");
        let paths: Vec<_> = MASKED_PROC_DIRECTORIES
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect();

        assert_eq!(
            paths,
            vec![
                "/proc/acpi",
                "/proc/asound",
                "/proc/bus",
                "/proc/driver",
                "/proc/fs",
                "/proc/irq",
                "/proc/scsi",
                "/proc/sys",
                "/proc/sysvipc",
            ]
        );
    }

    #[test]
    fn default_child_rlimits_are_conservative() {
        let limits = ChildRlimits::default();

        assert_eq!(limits.cpu_seconds, None);
        assert_eq!(limits.core_bytes, 0);
        assert_eq!(limits.file_size_bytes, 64 * 1024 * 1024);
        assert_eq!(limits.nofile, 1024);
        assert_eq!(limits.nproc, DEFAULT_PIDS_MAX);
        assert_eq!(limits.memlock_bytes, 0);
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
            seccomp_profile: SeccompProfile::Run,
        }
    }

    async fn execute_command_without_cgroup(plan: &CommandPlan) -> Result<JobResult, RunnerError> {
        let mut config = sandbox_config_without_namespaces();
        let cgroup_root = tempfile::tempdir().expect("tempdir");
        config.cgroup_root = cgroup_root.path().to_path_buf();
        seed_fake_cgroup(&config.cgroup_root);
        let (_cancel_tx, mut cancel_rx) = tokio::sync::watch::channel(false);
        execute_command(plan, &config, &mut cancel_rx).await
    }

    fn sandbox_config_without_namespaces() -> SandboxConfig {
        SandboxConfig {
            require_private_namespaces: false,
            ..Default::default()
        }
    }

    fn python3_path() -> Option<String> {
        let output = std::process::Command::new("sh")
            .arg("-c")
            .arg("command -v python3")
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let path = String::from_utf8(output.stdout).ok()?.trim().to_owned();
        if path.is_empty() {
            None
        } else {
            Some(path)
        }
    }

    fn seed_fake_cgroup(root: &Path) {
        let parent = root.join(RUNNER_CGROUP_NAME);
        fs::create_dir_all(&parent).expect("parent cgroup");
        fs::write(parent.join("cgroup.controllers"), "cpu memory pids").expect("controllers");
        fs::write(parent.join("cgroup.subtree_control"), "").expect("subtree control");
    }

    #[cfg(unix)]
    fn clear_cloexec(file: &fs::File) {
        use std::os::fd::AsRawFd;

        unsafe {
            let fd = file.as_raw_fd();
            let flags = libc::fcntl(fd, libc::F_GETFD);
            assert!(flags >= 0, "F_GETFD failed");
            assert_eq!(libc::fcntl(fd, libc::F_SETFD, flags & !libc::FD_CLOEXEC), 0);
        }
    }

    #[cfg(not(unix))]
    fn clear_cloexec(_: &fs::File) {}
}
