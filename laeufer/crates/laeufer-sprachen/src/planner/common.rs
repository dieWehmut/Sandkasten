use laeufer_core::{CommandPlan, Job, SeccompProfile};
use std::path::PathBuf;

pub(super) struct PhaseBudget {
    pub timeout: std::time::Duration,
    pub memory_limit_bytes: u64,
}

struct CommandBudget {
    timeout: std::time::Duration,
    memory_limit_bytes: u64,
    seccomp_profile: SeccompProfile,
}

pub(super) fn compile_command_plan(
    program: impl Into<String>,
    args: Vec<String>,
    env: Vec<(String, String)>,
    cwd: PathBuf,
    stdin: bytes::Bytes,
    phase_budget: PhaseBudget,
    job: &Job,
) -> CommandPlan {
    command_plan(
        program,
        args,
        env,
        cwd,
        stdin,
        CommandBudget {
            timeout: phase_budget.timeout,
            memory_limit_bytes: phase_budget.memory_limit_bytes,
            seccomp_profile: SeccompProfile::Compile,
        },
        job,
    )
}

pub(super) fn run_command_plan(
    program: impl Into<String>,
    args: Vec<String>,
    env: Vec<(String, String)>,
    cwd: PathBuf,
    stdin: bytes::Bytes,
    phase_budget: PhaseBudget,
    job: &Job,
) -> CommandPlan {
    command_plan(
        program,
        args,
        env,
        cwd,
        stdin,
        CommandBudget {
            timeout: phase_budget.timeout,
            memory_limit_bytes: phase_budget.memory_limit_bytes,
            seccomp_profile: SeccompProfile::Run,
        },
        job,
    )
}

fn command_plan(
    program: impl Into<String>,
    args: Vec<String>,
    env: Vec<(String, String)>,
    cwd: PathBuf,
    stdin: bytes::Bytes,
    phase_budget: CommandBudget,
    job: &Job,
) -> CommandPlan {
    CommandPlan {
        program: program.into(),
        args,
        env,
        cwd,
        stdin,
        timeout: phase_budget.timeout,
        memory_limit_bytes: phase_budget.memory_limit_bytes,
        cpu_millis: job.limits.cpu_millis,
        max_output_bytes: job.limits.max_output_bytes,
        seccomp_profile: phase_budget.seccomp_profile,
    }
}
