use laeufer_core::{CommandPlan, RunnerError, Sandbox};
use laeufer_sandbox::{LinuxSandbox, SandboxConfig};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tempfile::TempDir;
use tokio::sync::watch;

#[tokio::test]
#[ignore = "requires a privileged Linux runner with writable cgroup v2"]
async fn denies_network_from_child_namespace() {
    let harness = SecurityHarness::new();
    harness.preflight().await;

    let err = harness
        .run_shell(
            r#"python3 - <<'PY'
import socket
s = socket.socket()
s.settimeout(1)
s.connect(("1.1.1.1", 53))
PY"#,
            4096,
            Duration::from_secs(3),
            128 * 1024 * 1024,
        )
        .await
        .expect("network probe should execute and fail inside child");

    assert_ne!(
        err.exit_code,
        Some(0),
        "network connect unexpectedly worked"
    );
}

#[tokio::test]
#[ignore = "requires a privileged Linux runner with writable cgroup v2"]
async fn enforces_output_limit_and_truncates_stdout() {
    let harness = SecurityHarness::new();
    harness.preflight().await;

    let err = harness
        .run_shell(
            "yes x | head -c 1048576",
            1024,
            Duration::from_secs(5),
            128 * 1024 * 1024,
        )
        .await
        .expect_err("output flood should trip output limit");

    assert!(
        matches!(err, RunnerError::OutputLimitExceeded(_)),
        "{err:?}"
    );
}

#[tokio::test]
#[ignore = "requires a privileged Linux runner with writable cgroup v2"]
async fn enforces_wall_time_and_kills_descendants() {
    let harness = SecurityHarness::new();
    harness.preflight().await;

    let err = harness
        .run_shell(
            "(sleep 60 &) ; sleep 60",
            4096,
            Duration::from_millis(100),
            128 * 1024 * 1024,
        )
        .await
        .expect_err("long running process should time out");

    assert!(matches!(err, RunnerError::TimeLimitExceeded(_)), "{err:?}");
}

#[tokio::test]
#[ignore = "requires a privileged Linux runner with writable cgroup v2"]
async fn enforces_memory_cgroup_limit() {
    let harness = SecurityHarness::new();
    harness.preflight().await;

    let err = harness
        .run_shell(
            r#"python3 - <<'PY'
chunks = []
while True:
    chunks.append(bytearray(8 * 1024 * 1024))
PY"#,
            4096,
            Duration::from_secs(10),
            32 * 1024 * 1024,
        )
        .await
        .expect_err("memory pressure should trip cgroup limit");

    assert!(
        matches!(err, RunnerError::MemoryLimitExceeded(_)),
        "{err:?}"
    );
}

#[tokio::test]
#[ignore = "requires a privileged Linux runner with writable cgroup v2"]
async fn enforces_pids_cgroup_limit() {
    let mut harness = SecurityHarness::new();
    harness.config.pids_max = 8;
    harness.config.child_rlimits.nproc = 8;
    harness.preflight().await;

    let result = harness
        .run_shell(
            r#"python3 - <<'PY'
import subprocess
import time
children = []
while True:
    children.append(subprocess.Popen(["sleep", "30"]))
    time.sleep(0.01)
PY"#,
            8192,
            Duration::from_secs(5),
            128 * 1024 * 1024,
        )
        .await;

    match result {
        Ok(output) => assert_ne!(
            output.exit_code,
            Some(0),
            "fork probe unexpectedly succeeded"
        ),
        Err(RunnerError::TimeLimitExceeded(_) | RunnerError::System(_)) => {}
        Err(error) => panic!("unexpected pids limit result: {error:?}"),
    }
}

#[tokio::test]
#[ignore = "requires a privileged Linux runner with writable cgroup v2"]
async fn enforces_nofile_rlimit() {
    let mut harness = SecurityHarness::new();
    harness.config.child_rlimits.nofile = 16;
    harness.preflight().await;

    let result = harness
        .run_shell(
            r#"python3 - <<'PY'
import errno
fds = []
while True:
    try:
        fds.append(open("/dev/null", "rb"))
    except OSError as exc:
        if exc.errno != errno.EMFILE:
            raise
        print("emfile")
        break
PY"#,
            4096,
            Duration::from_secs(3),
            128 * 1024 * 1024,
        )
        .await
        .expect("nofile probe should execute");

    assert_eq!(result.exit_code, Some(0), "{result:?}");
    assert_eq!(&result.stdout[..], b"emfile\n");
}

#[tokio::test]
#[ignore = "requires a privileged Linux runner with writable cgroup v2"]
async fn enforces_file_size_rlimit() {
    let mut harness = SecurityHarness::new();
    harness.config.child_rlimits.file_size_bytes = 1024;
    harness.preflight().await;

    let result = harness
        .run_shell(
            r#"python3 - <<'PY'
import errno
try:
    with open("big-output.bin", "wb") as output:
        output.write(b"x" * (256 * 1024))
        output.flush()
except OSError as exc:
    if exc.errno != errno.EFBIG:
        raise
    print("efbig")
else:
    raise SystemExit("file-size rlimit did not fire")
PY"#,
            4096,
            Duration::from_secs(3),
            128 * 1024 * 1024,
        )
        .await
        .expect("file-size probe should execute");

    assert_eq!(result.exit_code, Some(0), "{result:?}");
    assert_eq!(&result.stdout[..], b"efbig\n");
}

#[tokio::test]
#[ignore = "requires a privileged Linux runner with writable cgroup v2"]
async fn enforces_cpu_rlimit() {
    let mut harness = SecurityHarness::new();
    harness.config.child_rlimits.cpu_seconds = Some(1);
    harness.preflight().await;

    let result = harness
        .run_shell(
            r#"python3 - <<'PY'
while True:
    pass
PY"#,
            4096,
            Duration::from_secs(5),
            128 * 1024 * 1024,
        )
        .await
        .expect("cpu rlimit should terminate before wall timeout");

    assert_ne!(
        result.exit_code,
        Some(0),
        "busy loop unexpectedly exited successfully: {result:?}"
    );
}

#[tokio::test]
#[ignore = "requires LAEUFER_SECURITY_ROOTFS and privileged mount/pivot_root support"]
async fn rootfs_hides_host_filesystem() {
    let Some(rootfs) = std::env::var_os("LAEUFER_SECURITY_ROOTFS").map(PathBuf::from) else {
        eprintln!("skipping rootfs test: set LAEUFER_SECURITY_ROOTFS");
        return;
    };
    let mut harness = SecurityHarness::new();
    let host_sentinel = harness._tempdir.path().join("host-only-secret");
    fs::write(&host_sentinel, "secret").expect("host sentinel");
    let workspace = harness._tempdir.path().join("workspace");
    fs::create_dir_all(&workspace).expect("workspace");
    std::os::unix::fs::symlink(&host_sentinel, workspace.join("host-escape-link"))
        .expect("host escape symlink");
    harness.config.rootfs = Some(rootfs);
    harness.preflight().await;

    let script = format!(
        r#"test "$(pwd)" = "/workspace"
test ! -e {}
test ! -e /.sandkasten-old-root
test -L /workspace/host-escape-link
test ! -e /workspace/host-escape-link
if sh -c 'printf nope > /rootfs-write-probe' 2>/dev/null; then
  exit 42
fi
printf workspace-ok > /workspace/write-ok
test "$(cat /workspace/write-ok)" = "workspace-ok"
test -c /dev/null
test -c /dev/zero
test -c /dev/random
test -c /dev/urandom
test ! -e /dev/kvm
test ! -e /dev/net/tun
printf dev-ok > /dev/null
for path in /proc/kcore /proc/keys /proc/timer_list /proc/sched_debug; do
  test ! -e "$path" || test -c "$path"
done
for dir in /proc/acpi /proc/asound /proc/bus /proc/driver /proc/fs /proc/irq /proc/scsi /proc/sys /proc/sysvipc; do
  test -d "$dir"
  for entry in "$dir"/* "$dir"/.[!.]* "$dir"/..?*; do
    test ! -e "$entry"
  done
done
printf ok"#,
        shell_quote(host_sentinel.to_string_lossy().as_ref())
    );
    let result = harness
        .run_shell(&script, 4096, Duration::from_secs(3), 128 * 1024 * 1024)
        .await
        .expect("rootfs probe should run");

    assert_eq!(result.exit_code, Some(0));
    assert_eq!(&result.stdout[..], b"ok");
}

#[tokio::test]
#[ignore = "requires a privileged Linux runner with writable cgroup v2"]
async fn blocks_privileged_syscalls_with_seccomp() {
    let harness = SecurityHarness::new();
    harness.preflight().await;

    let result = harness
        .run_shell(
            r#"python3 - <<'PY'
import socket
socket.socket(socket.AF_INET, socket.SOCK_STREAM)
PY"#,
            4096,
            Duration::from_secs(3),
            128 * 1024 * 1024,
        )
        .await
        .expect("seccomp probe should execute");

    assert_eq!(
        result.signal,
        Some(libc::SIGSYS),
        "socket() was not killed by seccomp: {result:?}"
    );
}

fn shell_quote(value: &str) -> String {
    let mut quoted = String::from("'");
    for part in value.split('\'') {
        if quoted.len() > 1 {
            quoted.push_str("'\\''");
        }
        quoted.push_str(part);
    }
    quoted.push('\'');
    quoted
}

struct SecurityHarness {
    _tempdir: TempDir,
    config: SandboxConfig,
}

impl SecurityHarness {
    fn new() -> Self {
        let tempdir = tempfile::tempdir().expect("tempdir");
        let config = SandboxConfig {
            cgroup_root: cgroup_root_from_env(),
            sandbox_root: tempdir.path().join("sandbox"),
            memory_swap_max_bytes: Some(0),
            ..Default::default()
        };
        Self {
            _tempdir: tempdir,
            config,
        }
    }

    async fn preflight(&self) {
        LinuxSandbox::new(self.config.clone())
            .preflight()
            .await
            .expect("security preflight should pass");
    }

    async fn run_shell(
        &self,
        script: &str,
        max_output_bytes: u64,
        timeout: Duration,
        memory_limit_bytes: u64,
    ) -> Result<laeufer_core::JobResult, RunnerError> {
        let cwd = self._tempdir.path().join("workspace");
        fs::create_dir_all(&cwd).expect("workspace");
        make_workspace_writable(&cwd);
        let plan = CommandPlan {
            program: "/bin/sh".to_owned(),
            args: vec!["-c".to_owned(), script.to_owned()],
            env: vec![
                ("PATH".to_owned(), "/usr/local/bin:/usr/bin:/bin".to_owned()),
                ("PYTHONDONTWRITEBYTECODE".to_owned(), "1".to_owned()),
            ],
            cwd,
            stdin: Default::default(),
            timeout,
            memory_limit_bytes,
            cpu_millis: 1000,
            max_output_bytes,
        };
        let (_cancel_tx, mut cancel_rx) = watch::channel(false);

        LinuxSandbox::new(self.config.clone())
            .execute(&plan, &mut cancel_rx)
            .await
    }
}

#[cfg(unix)]
fn make_workspace_writable(path: &Path) {
    use std::os::unix::fs::PermissionsExt;

    let mut permissions = fs::metadata(path)
        .expect("workspace metadata")
        .permissions();
    permissions.set_mode(0o777);
    fs::set_permissions(path, permissions).expect("workspace permissions");
}

#[cfg(not(unix))]
fn make_workspace_writable(_: &Path) {}

fn cgroup_root_from_env() -> PathBuf {
    std::env::var_os("LAEUFER_SECURITY_CGROUP_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new("/sys/fs/cgroup").to_path_buf())
}
