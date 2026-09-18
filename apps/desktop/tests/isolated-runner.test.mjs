import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
  DEFAULT_DISTRO_CANDIDATES,
  ISOLATION_FLAGS,
  ISOLATION_MARKER,
  buildIsolatedCommand,
  createIsolatedRunner,
  isolationProbeScript,
  parseIsolationProbe,
  sanitizeWslNoise,
  toDistroPath,
} from '../src/isolated-runner.mjs';

test('isolation always drops into user, network, and pid namespaces', () => {
  assert.deepEqual(ISOLATION_FLAGS, ['--user', '--map-root-user', '--net', '--pid', '--fork', '--mount-proc']);
});

test('turns a Windows path into the WSL mount path', () => {
  assert.equal(toDistroPath('C:\\Users\\dev\\ws\\main.py'), '/mnt/c/Users/dev/ws/main.py');
  assert.equal(toDistroPath('D:\\projects\\a b\\x.go'), '/mnt/d/projects/a b/x.go');
  assert.equal(toDistroPath('/already/posix.py'), '/already/posix.py');
});

test('builds a bounded unshare invocation that runs inside the file folder', () => {
  const command = buildIsolatedCommand({
    distro: 'Ubuntu-22.04',
    filePath: 'C:\\ws\\pkg\\main.py',
    command: 'python3',
    args: ['{file}'],
  });
  assert.equal(command.executable, 'wsl.exe');
  assert.deepEqual(command.args.slice(0, 4), ['-d', 'Ubuntu-22.04', '--exec', 'unshare']);
  assert.ok(command.args.includes('--net'));
  assert.ok(command.args.includes('--pid'));
  assert.equal(command.workingDirectory, '/mnt/c/ws/pkg');
  const shell = command.args.at(-1);
  assert.match(shell, /cd "\/mnt\/c\/ws\/pkg"/);
  assert.match(shell, /python3/);
  assert.match(shell, /\/mnt\/c\/ws\/pkg\/main\.py/);
});

test('reads the isolation markers a probe prints', () => {
  assert.deepEqual(
    parseIsolationProbe('SANDFACT:ok\nSANDFACT:pid1\nSANDFACT:net-blocked\n'),
    { ok: true, pidIsolated: true, networkBlocked: true },
  );
  assert.equal(parseIsolationProbe('nothing here').ok, false);
});

test('drops the UTF-16 diagnostics wsl.exe mixes into stderr', () => {
  const noisy = 'w\u0000s\u0000l\u0000:\u0000 \u0000w\u0000a\u0000r\u0000n\u0000\n\u0000\r\u0000\n\u0000';
  assert.equal(sanitizeWslNoise('real stderr'), 'real stderr');
  assert.equal(sanitizeWslNoise(noisy), '');
  // wsl.exe also prints plain UTF-8 diagnostics when a console is attached.
  assert.equal(sanitizeWslNoise('wsl: attach failed\r\nreal stderr\n'), 'real stderr');
  assert.equal(sanitizeWslNoise('WSL: attach failed\nkept\n'), 'kept');
});

test('the network probe uses bash, because dash cannot open /dev/tcp', () => {
  const script = isolationProbeScript();
  assert.ok(script.includes('bash -c'), 'the probe must not rely on sh for /dev/tcp');
  assert.ok(!/ sh -c 'exec 3<>/.test(script), 'sh would fail for reasons unrelated to the namespace');
  assert.ok(script.includes(`${ISOLATION_MARKER}:net-blocked`));
});

test('ships a default distro preference order', () => {
  assert.ok(DEFAULT_DISTRO_CANDIDATES.length > 0);
  for (const name of DEFAULT_DISTRO_CANDIDATES) assert.equal(typeof name, 'string');
});

// A fake child process that behaves like node:child_process.spawn for the
// runner: piped stdio, close events, and a kill that ends the process.
function fakeSpawn(plan) {
  const calls = [];
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.stdout = new Readable({ read() {} });
    child.stderr = new Readable({ read() {} });
    let closed = false;
    const close = (code, signal = null) => {
      if (closed) return;
      closed = true;
      child.stdout.push(null);
      child.stderr.push(null);
      setImmediate(() => child.emit('close', code, signal));
    };
    child.kill = (signal = 'SIGKILL') => {
      child.killedWith = signal;
      close(null, signal);
      return true;
    };
    setImmediate(() => {
      if (plan.stdout) child.stdout.push(plan.stdout);
      if (plan.stderr) child.stderr.push(plan.stderr);
      if (plan.hold) return;
      close(plan.code ?? 0);
    });
    return child;
  };
  return { spawnImpl, calls };
}

function runnerWith(plan, options = {}) {
  const fake = fakeSpawn(plan);
  const runner = createIsolatedRunner({ spawnImpl: fake.spawnImpl, distros: ['Ubuntu-22.04'], ...options });
  return { runner, calls: fake.calls };
}

const RUN_ARGUMENTS = {
  jobId: 'job-1',
  path: 'main.py',
  absolutePath: 'C:\\ws\\main.py',
  language: 'python',
  command: 'python3',
  args: ['{file}'],
};

test('a run reports success, exit code, timing, and the namespaces it used', async () => {
  const { runner, calls } = runnerWith({ stdout: 'hello\n', code: 0 });
  const result = await runner.run(RUN_ARGUMENTS, { root: 'C:\\ws' });

  assert.equal(result.status, 'JOB_STATUS_SUCCEEDED');
  assert.equal(result.stdout, 'hello\n');
  assert.equal(result.exitCode, 0);
  assert.equal(result.isolated, true);
  assert.deepEqual(result.isolation.namespaces, ISOLATION_FLAGS);
  assert.equal(typeof result.durationMs, 'number');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'wsl.exe');
  assert.equal(runner.activeRuns.size, 0, 'a finished job leaves no entry behind');
});

test('a non-zero exit is reported as a failed run with its code', async () => {
  const { runner } = runnerWith({ stderr: 'boom\n', code: 2 });
  const result = await runner.run(RUN_ARGUMENTS, { root: 'C:\\ws' });

  assert.equal(result.status, 'JOB_STATUS_RUNTIME_FAILED');
  assert.equal(result.exitCode, 2);
  assert.match(result.errorMessage, /code 2/);
  assert.equal(result.stderr, 'boom\n');
});

test('a canceled run is reported as canceled rather than as a crash', async () => {
  const { runner } = runnerWith({ hold: true });
  const pending = runner.run(RUN_ARGUMENTS, { root: 'C:\\ws' });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(runner.activeRuns.size, 1);
  assert.equal(await runner.stop('job-1'), true);
  const result = await pending;

  assert.equal(result.status, 'JOB_STATUS_CANCELED');
  assert.match(result.errorMessage, /canceled/i);
  assert.equal(runner.activeRuns.size, 0);
});

test('stopping an unknown job reports that nothing was canceled', async () => {
  const { runner } = runnerWith({ code: 0 });
  assert.equal(await runner.stop('missing'), false);
});

test('stopAll cancels every active job', async () => {
  const { runner } = runnerWith({ hold: true });
  const first = runner.run({ ...RUN_ARGUMENTS, jobId: 'job-a' }, { root: 'C:\\ws' });
  const second = runner.run({ ...RUN_ARGUMENTS, jobId: 'job-b' }, { root: 'C:\\ws' });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(runner.activeRuns.size, 2);
  await runner.stopAll();

  assert.equal((await first).status, 'JOB_STATUS_CANCELED');
  assert.equal((await second).status, 'JOB_STATUS_CANCELED');
});

test('a run past its time limit is reported as a time limit failure', async () => {
  const { runner } = runnerWith({ hold: true });
  const result = await runner.run({ ...RUN_ARGUMENTS, timeoutMs: 30 }, { root: 'C:\\ws' });

  assert.equal(result.status, 'JOB_STATUS_TIME_LIMIT_EXCEEDED');
  assert.equal(runner.activeRuns.size, 0);
});

test('a spawn failure is reported as a system error', async () => {
  const runner = createIsolatedRunner({
    distros: ['Ubuntu-22.04'],
    spawnImpl: () => { throw new Error('no wsl here'); },
  });
  const result = await runner.run(RUN_ARGUMENTS, { root: 'C:\\ws' });

  assert.equal(result.status, 'JOB_STATUS_SYSTEM_ERROR');
  assert.match(result.errorMessage, /no wsl here/);
});

test('detect skips a distro that cannot isolate and falls back to the next', async () => {
  const probes = [];
  const spawnImpl = (command, args) => {
    const distro = args[1];
    probes.push(distro);
    const child = new EventEmitter();
    child.stdout = new Readable({ read() {} });
    child.stderr = new Readable({ read() {} });
    const stdout = distro === 'Ubuntu'
      ? `${ISOLATION_MARKER}:ok\n${ISOLATION_MARKER}:pid1\n${ISOLATION_MARKER}:net-blocked\n`
      : `${ISOLATION_MARKER}:ok\n`;
    setImmediate(() => {
      child.stdout.push(stdout);
      child.stdout.push(null);
      child.stderr.push(null);
      child.emit('close', 0, null);
    });
    return child;
  };
  const runner = createIsolatedRunner({ spawnImpl, distros: ['Ubuntu-22.04', 'Ubuntu', 'Debian'] });
  const status = await runner.detect();

  assert.deepEqual(probes, ['Ubuntu-22.04', 'Ubuntu']);
  assert.deepEqual(status, { available: true, distro: 'Ubuntu', pidIsolated: true, networkBlocked: true });
});

test('detect reports the backend unavailable when no distro can isolate', async () => {
  const { runner } = runnerWith({ stdout: 'wsl: not installed\n', code: 1 }, { distros: ['Ubuntu-22.04'] });
  assert.deepEqual(await runner.detect(), { available: false, distro: '', pidIsolated: false, networkBlocked: false });
});
