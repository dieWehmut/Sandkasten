// Local (unsandboxed) execution for the desktop app: run a workspace file with
// the toolchain installed on this machine. The remote Sandkasten API stays the
// sandboxed path; this one exists so the desktop workbench can run code without
// a deployed server.
import { spawn as nodeSpawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { resolveInsideRoot } from './workspace.mjs';

export const DEFAULT_TIMEOUT_MS = 20_000;
export const MAX_TIMEOUT_MS = 120_000;
export const MAX_OUTPUT_BYTES = 1024 * 1024;
export const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

// {file} is the absolute path of the active workspace file; {exe} is the build
// output path for compiled languages; {name} is the file's base name, for
// runtimes that must be handed a path the target environment can resolve.
export const LOCAL_RUNTIMES = {
  python: { label: 'Python', command: 'python', args: ['{file}'], probe: ['--version'], extensions: ['.py', '.pyw'] },
  javascript: { label: 'JavaScript', command: 'node', args: ['{file}'], probe: ['--version'], extensions: ['.js', '.mjs', '.cjs'] },
  typescript: { label: 'TypeScript', command: 'node', args: ['{file}'], probe: ['--version'], extensions: ['.ts', '.mts', '.cts'] },
  go: {
    label: 'Go',
    // `go run` deletes its own temporary executable after the program exits; a
    // Windows lock on that file turns a successful program into a failed job.
    // Building explicitly moves the run into the same compile/run shape as the
    // other native runtimes and separates build errors from runtime errors.
    compile: { command: 'go', args: ['build', '-o', '{exe}', '{file}'] },
    run: { command: '{exe}', args: [] },
    probe: ['version'],
    native: true,
    extensions: ['.go'],
  },
  rust: {
    label: 'Rust',
    compile: { command: 'rustc', args: ['{file}', '-o', '{exe}'] },
    run: { command: '{exe}', args: [] },
    probe: ['--version'],
    native: true,
    extensions: ['.rs'],
  },
  c: {
    label: 'C',
    compile: { command: 'gcc', args: ['{file}', '-o', '{exe}'] },
    run: { command: '{exe}', args: [] },
    probe: ['--version'],
    native: true,
    extensions: ['.c'],
  },
  cpp: {
    label: 'C++',
    compile: { command: 'g++', args: ['{file}', '-o', '{exe}'] },
    run: { command: '{exe}', args: [] },
    probe: ['--version'],
    native: true,
    extensions: ['.cc', '.cpp', '.cxx'] },
  java: { label: 'Java', command: 'java', args: ['{file}'], probe: ['-version'], extensions: ['.java'] },
  ruby: { label: 'Ruby', command: 'ruby', args: ['{file}'], probe: ['--version'], extensions: ['.rb'] },
  php: { label: 'PHP', command: 'php', args: ['{file}'], probe: ['--version'], extensions: ['.php'] },
  bash: {
    label: 'Bash',
    command: 'bash',
    // A Windows `bash` is usually the WSL launcher, and WSL cannot open a
    // Windows absolute path; the run starts in the file's directory (which WSL
    // translates to /mnt/…), so the relative name is the portable argument.
    args: ['{name}'],
    probe: ['--version'],
    // A cold WSL distro start takes longer than the generic probe budget;
    // without the extension an installed Bash would be reported as missing.
    probeTimeoutMs: 20_000,
    extensions: ['.sh', '.bash'],
  },
  lua: { label: 'Lua', command: 'lua', args: ['{file}'], probe: ['-v'], extensions: ['.lua'] },
  perl: { label: 'Perl', command: 'perl', args: ['{file}'], probe: ['-v'], extensions: ['.pl'] },
  powershell: {
    label: 'PowerShell',
    // PowerShell 7 installs as `pwsh` and Windows ships Windows PowerShell as
    // `powershell`; whichever answers the probe runs the script.
    candidates: ['pwsh', 'powershell'],
    command: 'pwsh',
    // A default Windows client policy blocks local script files, so the run
    // asks for Bypass in this process only; the file is the user's own code and
    // local execution is already an explicit, unsandboxed opt-in.
    args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '{file}'],
    probe: ['-NoProfile', '-Command', 'exit 0'],
    // A cold PowerShell host start takes seconds on a loaded or emulated
    // machine, and the generic budget would report an installed shell as
    // missing.
    probeTimeoutMs: 15_000,
    extensions: ['.ps1'],
  },
};

export function resolveLocalPlan(language, options = {}) {
  const runtime = LOCAL_RUNTIMES[language];
  if (!runtime) throw new Error(`Local execution does not support the ${language || 'unknown'} runtime`);
  const filePath = options.filePath;
  if (typeof filePath !== 'string' || filePath === '') throw new Error('a workspace file is required');
  const jobId = typeof options.jobId === 'string' && options.jobId !== '' ? options.jobId : 'run';
  const platform = options.platform ?? process.platform;
  const tmpRoot = options.tmpRoot ?? os.tmpdir();

  const base = path.basename(filePath).replace(/\.[^.]+$/, '');
  const executable = path.join(tmpRoot, `sandkasten-local-run-${jobId.replace(/[^\w.-]/g, '_')}`, `${base}${platform === 'win32' ? '.exe' : ''}`);
  const substitute = (step) => {
    const fill = (text) => text
      .replaceAll('{file}', filePath).replaceAll('{exe}', executable).replaceAll('{name}', path.basename(filePath));
    return { command: fill(step.command), args: step.args.map(fill) };
  };
  // A runtime with several acceptable binaries runs the one detection resolved;
  // the renderer never chooses a command name.
  const command = typeof options.command === 'string' && options.command !== '' ? options.command : runtime.command;
  const run = runtime.run ?? { command, args: runtime.args };

  return {
    language,
    label: runtime.label,
    compile: runtime.compile ? substitute(runtime.compile) : undefined,
    run: substitute(run),
    executable: runtime.compile ? executable : undefined,
    workDirectory: options.workDirectory ?? path.dirname(filePath),
  };
}

export function runtimeForExtension(extension) {
  const normalized = String(extension ?? '').toLowerCase();
  for (const [language, runtime] of Object.entries(LOCAL_RUNTIMES)) {
    if (runtime.extensions.includes(normalized)) return language;
  }
  return '';
}

const LINKER_FAILURE = /linking with .*failed|unable to find linker|linker .*not found/i;

function findOnPath(name, environment = process.env, platform = process.platform) {
  const key = Object.keys(environment).find((entry) => entry.toLowerCase() === 'path') ?? 'PATH';
  const separator = platform === 'win32' ? ';' : ':';
  for (const entry of String(environment[key] ?? '').split(separator)) {
    const directory = entry.trim().replace(/^"|"$/g, '');
    if (!directory) continue;
    const candidate = path.join(directory, name);
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Keep looking: a missing entry is the normal case for most directories.
    }
  }
  return '';
}

/**
 * One actionable sentence for a compile failure, or '' when the cause is not one
 * we can name. The Windows case is worth naming: a Unix `link.exe` from MSYS2,
 * Git or Cygwin on PATH shadows the MSVC linker, and the compiler's own message
 * does not say that.
 */
export function diagnoseCompileFailure(stderr, {
  platform = process.platform, environment = process.env, findExecutable = findOnPath,
} = {}) {
  if (!LINKER_FAILURE.test(String(stderr ?? ''))) return '';
  if (platform !== 'win32') {
    return 'The linker for this target is missing or unusable: install the host C toolchain (for example build-essential or gcc).';
  }
  const linker = findExecutable('link.exe', environment, platform);
  if (linker && /(?:^|[\\/])(?:msys2?|git|cygwin)[^\\/]*[\\/]/i.test(linker)) {
    return `A Unix link.exe (${linker}) is shadowing the MSVC linker: run from a Visual Studio developer prompt, install the C++ build tools, or use a GNU toolchain.`;
  }
  return 'The MSVC linker is missing: install the Visual Studio C++ build tools (or use a GNU toolchain).';
}

// A toolchain probe that never exits (a broken shim, a stalled WSL relay, an
// interactive binary) must not block runtime detection: the probe is bounded and
// a timeout simply reports the runtime as unavailable.
function settleAvailability(spawnImpl, command, probe, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let child;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child?.kill('SIGKILL');
      } catch {
        // The process already exited.
      }
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
      child = spawnImpl(command, probe, { stdio: 'ignore', windowsHide: true });
    } catch {
      finish(false);
      return;
    }
    child.on('error', () => finish(false));
    child.on('close', () => finish(true));
  });
}

function collect(stream, limit, state) {
  if (!stream) return;
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    if (state.bytes >= limit) {
      state.truncated = true;
      return;
    }
    const remaining = limit - state.bytes;
    const text = chunk.length > remaining ? chunk.slice(0, remaining) : chunk;
    state.text += text;
    state.bytes += Buffer.byteLength(text, 'utf8');
    if (text.length < chunk.length) state.truncated = true;
  });
}

function runStep(step, { spawnImpl, cwd, timeoutMs, maxOutputBytes, onSpawn }) {
  return new Promise((resolve, reject) => {
    const stdout = { text: '', bytes: 0, truncated: false };
    const stderr = { text: '', bytes: 0, truncated: false };
    let child;
    try {
      child = spawnImpl(step.command, step.args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      reject(error);
      return;
    }
    onSpawn?.(child);
    collect(child.stdout, maxOutputBytes, stdout);
    collect(child.stderr, maxOutputBytes, stderr);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    child.on('error', (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.on('close', (code, signal) => {
      finish({
        code: typeof code === 'number' ? code : undefined,
        signal: typeof signal === 'number' ? signal : undefined,
        stdout: stdout.text,
        stderr: stderr.text,
        truncated: { stdout: stdout.truncated, stderr: stderr.truncated },
        timedOut,
      });
    });
  });
}

export function createLocalRunner(options = {}) {
  const spawnImpl = options.spawnImpl ?? nodeSpawn;
  const platform = options.platform ?? process.platform;
  const tmpRoot = options.tmpRoot ?? os.tmpdir();
  const maxOutputBytes = options.maxOutputBytes ?? MAX_OUTPUT_BYTES;
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const activeRuns = new Map();
  let detection;

  async function detect({ refresh = false } = {}) {
    if (detection && !refresh) return detection;
    const entries = await Promise.all(Object.entries(LOCAL_RUNTIMES).map(async ([language, runtime]) => {
      const primary = runtime.compile?.command ?? runtime.command;
      const candidates = runtime.candidates?.length ? [...runtime.candidates] : [primary];
      let command = primary;
      let available = false;
      for (const candidate of candidates) {
        available = await settleAvailability(spawnImpl, candidate, runtime.probe, runtime.probeTimeoutMs ?? probeTimeoutMs);
        if (available) { command = candidate; break; }
      }
      return { language, label: runtime.label, command, extensions: [...runtime.extensions], available };
    }));
    detection = entries;
    return detection;
  }

  // Only a runtime that declares alternatives needs the probe result to pick a
  // binary; every other runtime spawns its own command directly.
  async function commandFor(language) {
    const runtime = LOCAL_RUNTIMES[language];
    if (!runtime?.candidates?.length) return undefined;
    const entries = await detect().catch(() => []);
    return entries.find((entry) => entry.language === language)?.command ?? runtime.command;
  }

  function timeoutFor(requested) {
    const value = Number(requested);
    if (!Number.isFinite(value) || value <= 0) return defaultTimeoutMs;
    return Math.min(Math.max(Math.trunc(value), 1000), MAX_TIMEOUT_MS);
  }

  async function run(request, context = {}) {
    const root = context.root;
    const jobId = typeof request?.jobId === 'string' && request.jobId !== '' ? request.jobId : `local-${Date.now().toString(36)}`;
    const started = Date.now();
    const relativePath = request?.path;
    const language = request?.language;
    const absolute = resolveInsideRoot(root, relativePath);
    const info = await stat(absolute).catch(() => null);
    if (!info?.isFile()) throw new Error(`workspace file not found: ${relativePath}`);

    const command = await commandFor(language);
    const plan = resolveLocalPlan(language, { filePath: absolute, jobId, platform, tmpRoot, workDirectory: path.dirname(absolute), command });
    const timeoutMs = timeoutFor(request?.timeoutMs);
    const state = { canceled: false, child: undefined };
    activeRuns.set(jobId, state);

    const result = {
      jobId,
      status: 'JOB_STATUS_RUNTIME_FAILED',
      language,
      runtime: `local:${language}`,
      stdout: '',
      stderr: '',
      stdoutEncoding: 'utf8',
      stderrEncoding: 'utf8',
      compileStdout: '',
      compileStderr: '',
      compileStdoutEncoding: 'utf8',
      compileStderrEncoding: 'utf8',
      truncated: { stdout: false, stderr: false },
      command: [plan.run.command, ...plan.run.args].join(' '),
      workingDirectory: plan.workDirectory,
    };

    try {
      if (plan.compile) {
        await mkdir(path.dirname(plan.executable), { recursive: true });
        const compiled = await runStep(plan.compile, { spawnImpl, cwd: plan.workDirectory, timeoutMs, maxOutputBytes, onSpawn: (child) => { state.child = child; } });
        result.compileStdout = compiled.stdout;
        result.compileStderr = compiled.stderr;
        if (compiled.timedOut) {
          result.status = 'JOB_STATUS_TIME_LIMIT_EXCEEDED';
          result.errorMessage = 'Compilation exceeded the local time limit';
          return result;
        }
        if (compiled.code !== 0) {
          result.status = 'JOB_STATUS_COMPILE_FAILED';
          result.exitCode = compiled.code;
          result.errorMessage = 'Compilation failed';
          // The toolchain's own words are in compileStderr; say why they happened
          // when the cause is one we can name.
          result.hint = diagnoseCompileFailure(compiled.stderr || compiled.stdout, { platform });
          return result;
        }
      }

      const executed = await runStep(plan.run, { spawnImpl, cwd: plan.workDirectory, timeoutMs, maxOutputBytes, onSpawn: (child) => { state.child = child; } });
      result.stdout = executed.stdout;
      result.stderr = executed.stderr;
      result.truncated = executed.truncated;
      result.exitCode = executed.code;
      result.signal = executed.signal;
      if (state.canceled) {
        result.status = 'JOB_STATUS_CANCELED';
        result.errorMessage = 'Local run canceled';
      } else if (executed.timedOut) {
        result.status = 'JOB_STATUS_TIME_LIMIT_EXCEEDED';
        result.errorMessage = `Local run exceeded the ${Math.round(timeoutMs / 1000)} s time limit`;
      } else if (executed.truncated.stdout || executed.truncated.stderr) {
        result.status = 'JOB_STATUS_OUTPUT_LIMIT_EXCEEDED';
      } else if (executed.code === 0) {
        result.status = 'JOB_STATUS_SUCCEEDED';
      } else {
        result.status = 'JOB_STATUS_RUNTIME_FAILED';
        result.errorMessage = `Process exited with code ${executed.code ?? 'unknown'}`;
      }
      return result;
    } catch (error) {
      if (state.canceled) {
        result.status = 'JOB_STATUS_CANCELED';
        result.errorMessage = 'Local run canceled';
        return result;
      }
      result.status = 'JOB_STATUS_SYSTEM_ERROR';
      result.errorMessage = error instanceof Error ? error.message : String(error);
      return result;
    } finally {
      activeRuns.delete(jobId);
      result.durationMs = Date.now() - started;
      if (plan.executable) await rm(path.dirname(plan.executable), { recursive: true, force: true }).catch(() => {});
    }
  }

  async function stop(jobId) {
    const state = activeRuns.get(jobId);
    if (!state) return false;
    state.canceled = true;
    try {
      state.child?.kill('SIGKILL');
    } catch {
      // The process already exited.
    }
    return true;
  }

  async function stopAll() {
    for (const jobId of [...activeRuns.keys()]) await stop(jobId);
  }

  return { detect, run, stop, stopAll, activeRuns };
}