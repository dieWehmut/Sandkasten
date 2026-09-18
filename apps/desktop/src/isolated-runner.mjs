// Isolated execution through WSL2.
//
// The desktop app ships two local backends: the plain local runner, which uses
// the toolchains on PATH, and this one, which runs the same workspace file
// inside a Linux user, network, and PID namespace. The namespace set is what
// makes it a sandbox rather than a convenience:
//
//   --user --map-root-user  the payload sees uid 0 but holds no host privilege
//   --net                   a fresh network namespace with only loopback, so the
//                           payload cannot reach the LAN or the internet
//   --pid --fork            a fresh PID namespace, so it cannot see or signal
//                           host processes
//   --mount-proc            /proc reflects that PID namespace, not the host's
//
// WSL is the boundary to Windows: the payload reads only what the selected
// distro mounts, and the workspace reaches it through the drive mapping.
import { spawn as nodeSpawn } from 'node:child_process';

export const ISOLATION_FLAGS = ['--user', '--map-root-user', '--net', '--pid', '--fork', '--mount-proc'];

// Preferred distros, richest toolchain first. The first one that answers the
// probe wins; a machine without a usable distro reports the backend as
// unavailable instead of failing a run.
export const DEFAULT_DISTRO_CANDIDATES = ['Ubuntu-22.04', 'Ubuntu', 'Debian'];

export const ISOLATION_MARKER = 'SANDFACT';

export function toDistroPath(windowsPath) {
  if (typeof windowsPath !== 'string' || windowsPath === '') return '';
  if (windowsPath.startsWith('/')) return windowsPath;
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(windowsPath);
  if (!match) return windowsPath;
  const rest = match[2].replaceAll('\\', '/');
  return `/mnt/${match[1].toLowerCase()}/${rest}`;
}

export function buildIsolatedCommand({ distro, filePath, command, args = [], maxOutputBytes, workingDirectory } = {}) {
  const target = toDistroPath(filePath);
  const inner = [command, ...args.map((argument) => argument.replaceAll('{file}', target))];
  const directory = toDistroPath(workingDirectory) || target.slice(0, target.lastIndexOf('/')) || '/';
  // wsl.exe has no --cd for a namespaced payload, so the entry point moves into
  // the file's own folder before exec'ing the runtime.
  const entry = ['sh', '-c', `cd ${JSON.stringify(directory)} && exec ${inner.map((part) => JSON.stringify(part)).join(' ')}`];
  return {
    executable: 'wsl.exe',
    args: [
      '-d', distro,
      '--exec',
      'unshare', ...ISOLATION_FLAGS,
      '--',
      ...entry,
    ],
    filePath: target,
    workingDirectory: directory,
    timedOut: false,
    maxOutputBytes,
  };
}

// wsl.exe writes its own diagnostics on stderr in UTF-16, which interleaves
// with the payload's UTF-8. Decoding and dropping those lines keeps the
// reported stderr about the program the user ran.
export function sanitizeWslNoise(text) {
  const raw = String(text ?? '');
  const decoded = raw.includes('\u0000') ? raw.replace(/\u0000/g, '') : raw;
  // Payload stderr passes through byte-for-byte unless it actually carries a
  // wsl.exe diagnostic; only then is it reassembled line by line.
  if (!/^\s*wsl\s*:/im.test(decoded)) return decoded;
  return decoded
    .split(/\r?\n/)
    .filter((line) => !/^\s*wsl\s*:/i.test(line) && line.trim() !== '')
    .join('\n');
}

export function parseIsolationProbe(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const facts = new Set(
    lines.filter((line) => line.startsWith(`${ISOLATION_MARKER}:`)).map((line) => line.slice(ISOLATION_MARKER.length + 1)),
  );
  return {
    ok: facts.has('ok'),
    pidIsolated: facts.has('pid1'),
    networkBlocked: facts.has('net-blocked'),
  };
}


// Probes one distro: it must answer, ship unshare, and actually create a PID
// namespace. Anything less and the distro cannot back an isolated run.
export function isolationProbeScript() {
  return [
    `echo ${ISOLATION_MARKER}:ok`,
    `command -v unshare >/dev/null 2>&1 && echo ${ISOLATION_MARKER}:unshare`,
    `unshare ${ISOLATION_FLAGS.join(' ')} sh -c 'test "$(cat /proc/1/comm)" != init && echo ${ISOLATION_MARKER}:pid1' 2>/dev/null`,
    // "/dev/tcp" is a bash feature; dash fails to open it for an unrelated
    // reason and would report the sandbox as blocking traffic it never tested.
    `command -v bash >/dev/null 2>&1 && { unshare ${ISOLATION_FLAGS.join(' ')} bash -c 'exec 3<>/dev/tcp/1.1.1.1/53' 2>/dev/null && echo ${ISOLATION_MARKER}:net-open || echo ${ISOLATION_MARKER}:net-blocked; }`,
  ].join('; ');
}

export function createIsolatedRunner(options = {}) {
  const spawnImpl = options.spawnImpl ?? nodeSpawn;
  const distros = Array.isArray(options.distros) && options.distros.length ? options.distros : DEFAULT_DISTRO_CANDIDATES;
  const probeTimeoutMs = options.probeTimeoutMs ?? 90_000;
  const activeRuns = new Map();
  let detection;

  function runProcess(executable, args, { timeoutMs, maxOutputBytes, onSpawn, isCanceled } = {}) {
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = spawnImpl(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (error) {
        reject(error);
        return;
      }
      onSpawn?.(child);
      const out = { stdout: '', stderr: '', truncated: false };
      const limit = Number.isFinite(maxOutputBytes) && maxOutputBytes > 0 ? maxOutputBytes : 1024 * 1024;
      const collect = (stream, key) => {
        stream?.setEncoding?.('utf8');
        stream?.on?.('data', (chunk) => {
          if (out[key].length >= limit) {
            out.truncated = true;
            return;
          }
          out[key] += chunk;
        });
      };
      collect(child.stdout, 'stdout');
      collect(child.stderr, 'stderr');
      let timedOut = false;
      const timer = Number.isFinite(timeoutMs) && timeoutMs > 0
        ? setTimeout(() => {
          timedOut = true;
          try {
            child.kill('SIGKILL');
          } catch {
            // Already gone.
          }
        }, timeoutMs)
        : undefined;
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(value);
      };
      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code, signal) => finish({ code, signal, timedOut, canceled: Boolean(isCanceled?.()), ...out }));
    });
  }

  async function detect({ refresh = false } = {}) {
    if (detection && !refresh) return detection;
    for (const distro of distros) {
      let output;
      try {
        const result = await runProcess('wsl.exe', ['-d', distro, '--exec', 'sh', '-c', isolationProbeScript()], { timeoutMs: probeTimeoutMs });
        output = result.stdout;
      } catch {
        continue;
      }
      const facts = parseIsolationProbe(output);
      if (!facts.ok || !facts.pidIsolated) continue;
      detection = { available: true, distro, pidIsolated: true, networkBlocked: facts.networkBlocked };
      return detection;
    }
    detection = { available: false, distro: '', pidIsolated: false, networkBlocked: false };
    return detection;
  }

  async function run(request = {}, context = {}) {
    const root = context.root;
    const distro = request.distro || detection?.distro || distros[0];
    const windowsPath = typeof request.absolutePath === 'string' ? request.absolutePath : '';
    const jobId = request.jobId ?? 'isolated-run';
    const command = buildIsolatedCommand({
      distro,
      filePath: windowsPath,
      command: request.command,
      args: request.args ?? ['{file}'],
      maxOutputBytes: request.maxOutputBytes,
      workingDirectory: request.workingDirectory ?? (windowsPath.includes('\\') ? windowsPath.slice(0, windowsPath.lastIndexOf('\\')) : ''),
    });
    const state = { canceled: false, child: undefined };
    activeRuns.set(jobId, state);
    const started = Date.now();
    const result = {
      jobId,
      status: 'JOB_STATUS_RUNTIME_FAILED',
      language: request.language,
      runtime: `isolated:${request.language}`,
      stdout: '',
      stderr: '',
      stdoutEncoding: 'utf8',
      stderrEncoding: 'utf8',
      command: [command.executable, ...command.args].join(' '),
      workingDirectory: root ?? '',
      isolated: true,
      isolation: { distro, namespaces: [...ISOLATION_FLAGS] },
    };
    try {
      const executed = await runProcess(command.executable, command.args, {
        timeoutMs: request.timeoutMs,
        maxOutputBytes: request.maxOutputBytes,
        onSpawn: (child) => { state.child = child; },
        isCanceled: () => state.canceled,
      });
      result.stdout = executed.stdout;
      result.stderr = sanitizeWslNoise(executed.stderr);
      result.exitCode = typeof executed.code === 'number' ? executed.code : undefined;
      result.signal = typeof executed.signal === 'number' ? executed.signal : undefined;
      result.truncated = { stdout: executed.truncated, stderr: executed.truncated };
      if (state.canceled) {
        result.status = 'JOB_STATUS_CANCELED';
        result.errorMessage = 'Isolated run canceled';
      } else if (executed.timedOut) {
        result.status = 'JOB_STATUS_TIME_LIMIT_EXCEEDED';
        result.errorMessage = 'The isolated run exceeded its time limit';
      } else if (executed.truncated) {
        result.status = 'JOB_STATUS_OUTPUT_LIMIT_EXCEEDED';
      } else if (executed.code === 0) {
        result.status = 'JOB_STATUS_SUCCEEDED';
      } else {
        result.errorMessage = `Process exited with code ${executed.code ?? 'unknown'}`;
      }
    } catch (error) {
      if (state.canceled) {
        result.status = 'JOB_STATUS_CANCELED';
        result.errorMessage = 'Isolated run canceled';
      } else {
        result.status = 'JOB_STATUS_SYSTEM_ERROR';
        result.errorMessage = error instanceof Error ? error.message : String(error);
      }
    } finally {
      activeRuns.delete(jobId);
      result.durationMs = Date.now() - started;
    }
    return result;
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
