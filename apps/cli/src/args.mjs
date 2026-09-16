const optionFlags = new Map([
  ['--language', 'language'],
  ['--api', 'api'],
  ['--token', 'token'],
  ['--entrypoint', 'entrypoint'],
  ['--stdin', 'stdin'],
  ['--poll-interval', 'pollIntervalMs'],
  ['--json', 'json'],
]);

export function usage() {
  return [
    'Usage: sandkasten <command> [options]',
    '',
    'Commands:',
    '  run <file>       Submit a source file and poll until the job finishes',
    '  runtimes         List the runtimes exposed by the API',
    '  job <jobId>      Fetch a single job result',
    '',
    'Options:',
    '  --language <lang>       Runtime for run (default: API default)',
    '  --entrypoint <path>     Override the runtime entrypoint',
    '  --stdin <file>          Feed a file to the program standard input',
    '  --poll-interval <ms>    Polling interval for run (default: 1000)',
    '  --api <url>             API origin (or SANDKASTEN_API_BASE_URL)',
    '  --token <token>         API bearer token (or SANDKASTEN_API_TOKEN)',
    '  --json                  Emit machine-readable JSON',
    '  --help                  Show this message',
    '',
    'Exit codes: 0 success, 1 failed job, 2 usage error, 3 API or network error.',
  ].join('\n');
}

export class UsageError extends Error {}

export class InputError extends Error {}

export function parseArgs(argv, environment = process.env) {
  const args = [...argv];
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h' || args[0] === 'help') {
    throw new UsageError(usage());
  }

  const command = args.shift();
  const parsed = {
    command,
    file: undefined,
    jobId: undefined,
    options: {
      language: undefined,
      api: environment.SANDKASTEN_API_BASE_URL || undefined,
      token: environment.SANDKASTEN_API_TOKEN || undefined,
      entrypoint: undefined,
      stdin: undefined,
      pollIntervalMs: 1000,
      json: false,
    },
  };

  if (command === 'run' || command === 'job') {
    const target = args.shift();
    if (target === undefined || target.startsWith('-')) {
      throw new UsageError(`${command} requires a ${command === 'run' ? 'file' : 'job id'}\n\n${usage()}`);
    }
    if (command === 'run') parsed.file = target;
    else parsed.jobId = target;
  } else if (command !== 'runtimes') {
    throw new UsageError(`unknown command: ${command}\n\n${usage()}`);
  }

  while (args.length > 0) {
    const flag = args.shift();
    if (flag === '--help' || flag === '-h') throw new UsageError(usage());
    if (!optionFlags.has(flag)) throw new UsageError(`unknown option: ${flag}\n\n${usage()}`);
    if (flag === '--json') {
      parsed.options.json = true;
      continue;
    }
    const value = args.shift();
    if (value === undefined || value.startsWith('--')) throw new UsageError(`${flag} requires a value`);
    const key = optionFlags.get(flag);
    if (key === 'pollIntervalMs') {
      const interval = Number(value);
      if (!Number.isFinite(interval) || interval <= 0) throw new UsageError(`invalid --poll-interval value: ${value}`);
      parsed.options.pollIntervalMs = interval;
    } else {
      parsed.options[key] = value;
    }
  }

  return parsed;
}
