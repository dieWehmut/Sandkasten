// Isolated execution through WSL2.
//
// The desktop app ships two local backends: the plain local runner, which uses
// the toolchains on PATH, and this one, which runs the same workspace file
// inside a Linux user, network, PID, and mount namespace. The namespace set is
// what makes it a sandbox rather than a convenience:
//
//   --user --map-root-user  the payload sees uid 0 but holds no host privilege
//   --net                   a fresh network namespace with only loopback, so the
//                           payload cannot reach the LAN or the internet
//   --pid --fork            a fresh PID namespace, so it cannot see or signal
//                           host processes
//   --mount-proc            /proc reflects that PID namespace, not the host's
//   --mount                 a private mount namespace, which is what lets the
//                           run hide the host files instead of only bounding
//                           what the payload can reach
//
// WSL is the boundary to Windows, and the mount namespace is the boundary to
// the files: the payload's own copy of its source lives in a directory this run
// owns, and the drives a distro mounts under /mnt are masked before the payload
// starts.
import { spawn as nodeSpawn } from 'node:child_process';

import { ISOLATED_LANGUAGES, isolatedLanguagesFrom, isolatedTools } from './isolated-languages.mjs';

export const ISOLATION_FLAGS = ['--user', '--map-root-user', '--net', '--pid', '--mount', '--fork', '--mount-proc'];

// What a run hides from the payload once its file is safely inside a private
// directory: the Windows drives a distro mounts under /mnt, the distro user's
// own files, and removable media.
export const ISOLATION_MASKS = ['/mnt', '/home', '/media'];

// The private directory a run copies its payload into. It is named after the
// job so concurrent runs cannot collide, and the run puts a tmpfs over it, so
// nothing the payload writes survives the namespace.
const SANDBOX_PREFIX = '/tmp/sandkasten';

/** The job id as one path segment: safe for a shell word and for the distro. */
export function sandboxName(jobId) {
  const cleaned = String(jobId ?? '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
  return cleaned || 'run';
}

/** The directory this run owns inside the distro. */
export function sandboxDirectory(jobId) {
  return `${SANDBOX_PREFIX}-${sandboxName(jobId)}`;
}

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

// One shell word, quoted so the shell that assembles the entry command cannot
// expand anything inside it: a payload script legitimately contains `$1` and
// command substitutions, and a path may contain spaces or quotes.
function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

// Inside a double-quoted shell word, these four characters still have a meaning:
// a file name may legitimately contain any of them on Windows.
function shellDoubleQuote(value) {
  return `"${String(value).replace(/[\\$"`]/g, (character) => `\\${character}`)}"`;
}

export function buildIsolatedCommand({ distro, filePath, command, args = [], maxOutputBytes, workingDirectory, jobId } = {}) {
  const source = toDistroPath(filePath);
  const name = source.slice(source.lastIndexOf('/') + 1) || 'payload';
  const sandbox = sandboxDirectory(jobId);
  const target = `${sandbox}/${name}`;
  const inner = [command, ...args.map((argument) => argument.replaceAll('{file}', target))];
  // The folder the user's file lives in is what the command preview should show;
  // the payload itself runs in the private directory.
  const display = toDistroPath(workingDirectory) || source.slice(0, source.lastIndexOf('/')) || '/';
  // wsl.exe has no --cd for a namespaced payload, so the entry point prepares the
  // private directory, masks the host, and only then exec's the runtime. The copy
  // happens before the masks, which is what makes hiding the host files possible
  // at all.
  const entry = ['sh', '-c', [
    `d=${shellQuote(sandbox)}`,
    'mkdir -p "$d" || exit 1',
    'mount -t tmpfs tmpfs "$d" 2>/dev/null || true',
    `cp -- ${shellQuote(source)} "$d/${name.replace(/[\\$"`]/g, (character) => `\\${character}`)}" || exit 1`,
    ...ISOLATION_MASKS.map((mount) => `mount -t tmpfs tmpfs ${shellQuote(mount)} 2>/dev/null || true`),
    'cd "$d" || exit 1',
    `exec ${inner.map(shellQuote).join(' ')}`,
  ].join('; ')];
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
    sandboxDirectory: sandbox,
    workingDirectory: display,
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
  const tools = new Set(
    [...facts].filter((fact) => fact.startsWith('tool:')).map((fact) => fact.slice('tool:'.length)).filter(Boolean),
  );
  // The namespaces cover user, network and PID. The host filesystem is a
  // separate question, and the payload answers it itself: the probe counts what
  // it can see under /mnt, which is where a WSL distro exposes the Windows
  // drives. Nothing under /mnt means the host files are out of reach.
  const mounts = [...facts].find((fact) => fact.startsWith('mounts:'));
  const drivers = mounts ? Number.parseInt(mounts.slice('mounts:'.length), 10) : Number.NaN;
  return {
    ok: facts.has('ok'),
    pidIsolated: facts.has('pid1'),
    networkBlocked: facts.has('net-blocked'),
    hostFilesystem: Number.isFinite(drivers) ? (drivers > 0 ? 'visible' : 'hidden') : 'unknown',
    tools,
  };
}


// Probes one distro: it must answer, ship unshare, and actually create a PID
// namespace. Anything less and the distro cannot back an isolated run. It also
// reports which binaries the isolated languages need, so the UI only offers the
// languages this distro can really run.
export function isolationProbeScript(tools = isolatedTools()) {
  return [
    `echo ${ISOLATION_MARKER}:ok`,
    `command -v unshare >/dev/null 2>&1 && echo ${ISOLATION_MARKER}:unshare`,
    `unshare ${ISOLATION_FLAGS.join(' ')} sh -c 'test "$(cat /proc/1/comm)" != init && echo ${ISOLATION_MARKER}:pid1' 2>/dev/null`,
    // "/dev/tcp" is a bash feature; dash fails to open it for an unrelated
    // reason and would report the sandbox as blocking traffic it never tested.
    `command -v bash >/dev/null 2>&1 && { unshare ${ISOLATION_FLAGS.join(' ')} bash -c 'exec 3<>/dev/tcp/1.1.1.1/53' 2>/dev/null && echo ${ISOLATION_MARKER}:net-open || echo ${ISOLATION_MARKER}:net-blocked; }`,
    // What the payload can read: a run copies its file into a private directory and
// masks the drives a distro mounts under /mnt, so the probe applies the same
// masks and counts what is left. A distro that refuses the mount still lists the
// drives, and the fact says so.
    `unshare ${ISOLATION_FLAGS.join(' ')} sh -c '${ISOLATION_MASKS.map((mount) => `mount -t tmpfs tmpfs ${mount} 2>/dev/null;`).join(' ')} set -- /mnt/*; [ -e "$1" ] && echo ${ISOLATION_MARKER}:mounts:$# || echo ${ISOLATION_MARKER}:mounts:0' 2>/dev/null`,
    ...tools.map((tool) => `command -v ${shellQuote(tool)} >/dev/null 2>&1 && echo ${ISOLATION_MARKER}:tool:${tool}`),
  ].join('; ');
}

/**
 * Killing `wsl.exe` ends the client, not the Linux process it started: a
 * cancelled or timed-out payload keeps running inside the distro until it
 * finishes on its own. The sandbox directory names the job, and the payload's
 * command line carries it, so the run is stopped by that marker. The pattern is
 * written with a character class so the cleanup command cannot match itself.
 */
export function sandboxKillCommand(jobId) {
  const target = sandboxDirectory(jobId);
  return `pkill -9 -f ${shellQuote(`[${target.slice(0, 1)}]${target.slice(1)}/`)} 2>/dev/null; exit 0`;
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
      // The cap bounds what is kept *and* stops the payload that exceeded it: the
      // rest of its output is discarded anyway, and letting it run on only burns
      // the machine until the time limit.
      const overflow = () => {
        out.truncated = true;
        try {
          child.kill('SIGKILL');
        } catch {
          // Already gone.
        }
      };
      const collect = (stream, key) => {
        stream?.setEncoding?.('utf8');
        stream?.on?.('data', (chunk) => {
          const kept = out[key].length;
          if (kept >= limit) {
            overflow();
            return;
          }
          // A single write can be larger than the whole budget: keep what fits and
          // stop the payload, rather than storing the chunk in full.
          const remaining = limit - kept;
          const text = chunk.length > remaining ? chunk.slice(0, remaining) : chunk;
          out[key] += text;
          if (text.length < chunk.length) overflow();
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
      // A distro that is starting, or a launcher that is busy, answers a probe
      // with nothing once in a while. Asking again is what keeps a hiccup at
      // startup from disabling the backend until the app is restarted.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let output;
        try {
          const result = await runProcess('wsl.exe', ['-d', distro, '--exec', 'sh', '-c', isolationProbeScript()], { timeoutMs: probeTimeoutMs });
          output = result.stdout;
        } catch {
          continue;
        }
        const facts = parseIsolationProbe(output);
        // Nothing at all means the probe never ran — a distro that is starting or
        // a launcher that is busy — so it is worth asking once more. A distro that
        // answered and cannot create the namespace is a verdict; move on.
        if (!facts.ok) continue;
        if (!facts.pidIsolated) break;
        detection = {
          available: true, distro, pidIsolated: true, networkBlocked: facts.networkBlocked,
          hostFilesystem: facts.hostFilesystem,
          languages: isolatedLanguagesFrom(facts.tools, ISOLATED_LANGUAGES),
        };
        return detection;
      }
    }
    detection = { available: false, distro: '', pidIsolated: false, networkBlocked: false, hostFilesystem: 'unknown', languages: {} };
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
      jobId,
      workingDirectory: request.workingDirectory ?? (windowsPath.includes('\\') ? windowsPath.slice(0, windowsPath.lastIndexOf('\\')) : ''),
    });
    // `done` settles when the run has finished *and* been cleaned up in the distro,
// which is what a caller stopping a run (or the app quitting) has to wait for.
    let settled;
    const state = { canceled: false, child: undefined, done: new Promise((resolve) => { settled = resolve; }) };
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
      // A payload that was killed from this side may still be alive over there.
      if (state.canceled || result.status === 'JOB_STATUS_TIME_LIMIT_EXCEEDED' || result.status === 'JOB_STATUS_OUTPUT_LIMIT_EXCEEDED') {
        await stopSandbox(distro, jobId);
      }
      result.durationMs = Date.now() - started;
      settled();
    }
    return result;
  }

  // Best effort and bounded: the distro may be gone or simply not answering, and
  // a run that already ended must not turn into a failed one because of it.
  async function stopSandbox(distro, jobId) {
    try {
      await runProcess('wsl.exe', ['-d', distro, '--exec', 'sh', '-c', sandboxKillCommand(jobId)], { timeoutMs: 15_000 });
    } catch {
      // Nothing left to clean up.
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
    // Waiting is what makes `stop` mean the payload is gone: the kill above ends
    // the client, and the cleanup that reaches the payload runs as the run
    // settles.
    await state.done;
    return true;
  }

  async function stopAll() {
    for (const jobId of [...activeRuns.keys()]) await stop(jobId);
  }

  return { detect, run, stop, stopAll, activeRuns };
}
