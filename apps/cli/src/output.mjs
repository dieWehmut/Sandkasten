const failedStatuses = new Set([
  'JOB_STATUS_COMPILE_FAILED',
  'JOB_STATUS_RUNTIME_FAILED',
  'JOB_STATUS_TIME_LIMIT_EXCEEDED',
  'JOB_STATUS_MEMORY_LIMIT_EXCEEDED',
  'JOB_STATUS_OUTPUT_LIMIT_EXCEEDED',
  'JOB_STATUS_CANCELED',
  'JOB_STATUS_SYSTEM_ERROR',
]);

export function failedStatusExitCode(job) {
  return failedStatuses.has(job?.status) ? 1 : 0;
}

export function jobExitCode(job) {
  return job?.status === 'JOB_STATUS_SUCCEEDED' ? 0 : 1;
}

function stream(name, value) {
  if (typeof value !== 'string' || value === '') return [];
  return [`${name}:`, value.replace(/\n$/, '')];
}

export function formatJobHuman(job) {
  const lines = [
    `job: ${job.jobId}`,
    `status: ${job.status}`,
  ];
  if (job.language) lines.push(`language: ${job.language}`);
  if (job.runtime) lines.push(`runtime: ${job.runtime}`);
  if (typeof job.exitCode === 'number') lines.push(`exit code: ${job.exitCode}`);
  if (typeof job.signal === 'number' && job.signal !== 0) lines.push(`signal: ${job.signal}`);
  if (typeof job.durationMs === 'number') lines.push(`duration: ${job.durationMs}ms`);
  if (job.errorMessage) lines.push(`error: ${job.errorMessage}`);
  lines.push(...stream('stdout', job.stdout));
  lines.push(...stream('compile stdout', job.compileStdout));
  lines.push(...stream('stderr', job.stderr));
  lines.push(...stream('compile stderr', job.compileStderr));
  return `${lines.join('\n')}\n`;
}

export function formatJobJson(job) {
  return `${JSON.stringify(job, null, 2)}\n`;
}

export function formatRuntimesHuman(runtimes) {
  const rows = runtimes.map((runtime) => {
    const aliases = Array.isArray(runtime.aliases) && runtime.aliases.length > 0 ? runtime.aliases.join(', ') : '-';
    const entrypoint = runtime.default_entrypoint ?? '-';
    const version = runtime.version ?? '-';
    return [runtime.language ?? '-', version, entrypoint, aliases];
  });
  const headers = ['language', 'version', 'entrypoint', 'aliases'];
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => String(row[index]).length)),
  );
  const render = (row) => row.map((cell, index) => String(cell).padEnd(widths[index])).join('  ').trimEnd();
  return `${[render(headers), ...rows.map(render)].join('\n')}\n`;
}

export function formatRuntimesJson(runtimes) {
  return `${JSON.stringify(runtimes, null, 2)}\n`;
}
