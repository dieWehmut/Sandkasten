import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
  LOCAL_RUNTIMES,
  createLocalRunner,
  diagnoseCompileFailure,
  resolveLocalPlan,
  runtimeForExtension,
} from '../src/local-runner.mjs';

// A fake child process that behaves like node:child_process.spawn for the
// runner: piped stdio, close events, and a kill that ends the process.
function fakeSpawn(plan) {
  const calls = [];
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.stdout = new Readable({ read() {} });
    child.stderr = new Readable({ read() {} });
    if (plan.error) {
      setImmediate(() => child.emit('error', Object.assign(new Error('spawn failed'), { code: plan.error })));
      return child;
    }
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

test('local plans substitute the file and executable placeholders', () => {
  const python = resolveLocalPlan('python', { filePath: path.resolve('/ws/main.py'), jobId: 'job-1', platform: 'linux', tmpRoot: '/tmp' });
  assert.deepEqual(python.run, { command: 'python', args: [path.resolve('/ws/main.py')] });
  assert.equal(python.compile, undefined);
  assert.equal(python.workDirectory, path.resolve('/ws'));

  const rust = resolveLocalPlan('rust', { filePath: path.resolve('/ws/main.rs'), jobId: 'job 2/3', platform: 'win32', tmpRoot: 'C:\\Temp' });
  assert.equal(rust.compile.command, 'rustc');
  assert.equal(rust.compile.args.at(-1), 'C:\\Temp\\sandkasten-local-run-job_2_3\\main.exe');
  assert.deepEqual(rust.run, { command: 'C:\\Temp\\sandkasten-local-run-job_2_3\\main.exe', args: [] });

  const go = resolveLocalPlan('go', { filePath: path.resolve('/ws/main.go'), jobId: 'job-3', platform: 'win32', tmpRoot: 'C:\\Temp' });
  assert.equal(go.compile.command, 'go');
  assert.deepEqual(go.compile.args.slice(0, 3), ['build', '-o', 'C:\\Temp\\sandkasten-local-run-job-3\\main.exe']);
  assert.equal(go.compile.args.at(-1), path.resolve('/ws/main.go'));
  assert.equal(go.run.command, 'C:\\Temp\\sandkasten-local-run-job-3\\main.exe');
  assert.deepEqual(go.run.args, []);

  // WSL cannot open a Windows absolute path, so Bash is handed the relative
  // name and runs in the file's own directory.
  const bash = resolveLocalPlan('bash', { filePath: path.resolve('/ws/hello world.sh'), jobId: 'job-4' });
  assert.deepEqual(bash.run, { command: 'bash', args: ['hello world.sh'] });
  assert.equal(bash.workDirectory, path.resolve('/ws'));

  // PowerShell falls back to `pwsh` until detection resolves an installed one.
  const fallback = resolveLocalPlan('powershell', { filePath: path.resolve('/ws/main.ps1'), jobId: 'job-5' });
  assert.deepEqual(fallback.run, {
    command: 'pwsh',
    args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('/ws/main.ps1')],
  });
  const resolved = resolveLocalPlan('powershell', { filePath: path.resolve('/ws/main.ps1'), jobId: 'job-6', command: 'powershell' });
  assert.equal(resolved.run.command, 'powershell');

  assert.throws(() => resolveLocalPlan('cobol', { filePath: '/ws/main.cob' }), /does not support/);
  assert.throws(() => resolveLocalPlan('python', {}), /workspace file/);
});

test('extensions map to canonical runtime names', () => {
  assert.equal(runtimeForExtension('.py'), 'python');
  assert.equal(runtimeForExtension('.TS'), 'typescript');
  assert.equal(runtimeForExtension('.rs'), 'rust');
  assert.equal(runtimeForExtension('.txt'), '');
  for (const [language, runtime] of Object.entries(LOCAL_RUNTIMES)) {
    for (const extension of runtime.extensions) {
      assert.equal(runtimeForExtension(extension), language);
    }
  }
});

test('Bash declares a probe budget that covers a cold WSL distro start', () => {
  assert.equal(LOCAL_RUNTIMES.bash.command, 'bash');
  assert.ok(LOCAL_RUNTIMES.bash.probeTimeoutMs >= 15_000,
    'the generic probe budget would report an installed WSL-backed Bash as missing');
});

test('PowerShell declares a probe budget that covers a cold host start', () => {
  assert.deepEqual(LOCAL_RUNTIMES.powershell.candidates, ['pwsh', 'powershell']);
  assert.ok(LOCAL_RUNTIMES.powershell.probeTimeoutMs >= 10_000,
    'a cold PowerShell host would be reported as missing under the generic budget');
});

test('a linker failure is named, including the Unix linker that shadows the MSVC one', () => {
  const shadowed = diagnoseCompileFailure('error: linking with `link.exe` failed: exit code: 1', {
    platform: 'win32',
    environment: { Path: 'C:\\msys64\\usr\\bin;C:\\Windows\\System32' },
    findExecutable: (name, _environment, _platform) => name === 'link.exe' ? 'C:\\msys64\\usr\\bin\\link.exe' : '',
  });
  assert.match(shadowed, /shadowing the MSVC linker/);
  assert.match(shadowed, /msys64/);

  const missing = diagnoseCompileFailure('error: linking with `link.exe` failed', {
    platform: 'win32', findExecutable: () => '',
  });
  assert.match(missing, /Visual Studio C\+\+ build tools/);

  const posix = diagnoseCompileFailure('collect2: error: ld returned 1; linking with `cc` failed', { platform: 'linux' });
  assert.match(posix, /C toolchain/);

  assert.equal(diagnoseCompileFailure('error[E0425]: cannot find value `x`', { platform: 'win32' }), '');
  assert.equal(diagnoseCompileFailure('', {}), '');
  assert.equal(diagnoseCompileFailure(undefined, {}), '');
});

test('a failed compile carries the diagnosis in the result', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sandkasten-run-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'main.c'), 'int main(void) { return 0; }\n');

  const linker = createLocalRunner({
    spawnImpl: fakeSpawn({ stderr: 'error: linking with `link.exe` failed: exit code: 1\n', code: 1 }).spawnImpl,
    platform: 'win32',
    tmpRoot: path.join(root, '.out'),
  });
  const failed = await linker.run({ jobId: 'job-link', path: 'main.c', language: 'c' }, { root });
  assert.equal(failed.status, 'JOB_STATUS_COMPILE_FAILED');
  assert.match(failed.hint, /linker/i);

  const syntax = createLocalRunner({
    spawnImpl: fakeSpawn({ stderr: 'main.c:1: error: expected `;`\n', code: 1 }).spawnImpl,
    platform: 'win32',
    tmpRoot: path.join(root, '.out'),
  });
  const plain = await syntax.run({ jobId: 'job-syntax', path: 'main.c', language: 'c' }, { root });
  assert.equal(plain.status, 'JOB_STATUS_COMPILE_FAILED');
  assert.equal(plain.hint, '', 'a source error is not a toolchain problem');
});

test('Go builds explicitly so a locked temporary executable cannot fail a good run', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sandkasten-run-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'main.go'), 'package main\n\nfunc main() {}\n');
  const executable = path.join(root, '.out', 'sandkasten-local-run-job-go', 'main.exe');

  const { spawnImpl, calls } = fakeSpawn({ stdout: 'ok\n', code: 0 });
  const runner = createLocalRunner({ spawnImpl, platform: 'win32', tmpRoot: path.join(root, '.out') });
  const result = await runner.run({ jobId: 'job-go', path: 'main.go', language: 'go' }, { root });
  assert.equal(result.status, 'JOB_STATUS_SUCCEEDED');
  assert.deepEqual(calls.map((call) => call.command), ['go', executable]);
  assert.deepEqual(calls[0].args.slice(0, 3), ['build', '-o', executable]);

  const { spawnImpl: failing, calls: failingCalls } = fakeSpawn({ stderr: 'cannot build\n', code: 2 });
  const buildFailure = await createLocalRunner({ spawnImpl: failing, platform: 'win32', tmpRoot: path.join(root, '.out') })
    .run({ jobId: 'job-go-bad', path: 'main.go', language: 'go' }, { root });
  assert.equal(buildFailure.status, 'JOB_STATUS_COMPILE_FAILED');
  assert.equal(buildFailure.compileStderr, 'cannot build\n');
  assert.equal(failingCalls.length, 1, 'a failed build must not run the executable');
});

test('a runtime with alternative binaries probes them in order and runs the one that answers', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sandkasten-run-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'main.ps1'), 'Write-Output "hi"\n');

  const calls = [];
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args });
    const plan = command === 'pwsh' ? { error: 'ENOENT' } : { stdout: 'hi\n', code: 0 };
    return fakeSpawn(plan).spawnImpl(command, args, options);
  };
  const runner = createLocalRunner({ spawnImpl, platform: 'win32', tmpRoot: path.join(root, '.out') });
  const entry = (await runner.detect()).find((item) => item.language === 'powershell');
  assert.equal(entry.available, true);
  assert.equal(entry.command, 'powershell');
  // Detection probes every runtime; the PowerShell candidates stay in order.
  const probed = calls.filter((call) => ['pwsh', 'powershell'].includes(call.command)).map((call) => call.command);
  assert.deepEqual(probed, ['pwsh', 'powershell'], 'candidates are probed in order');

  calls.length = 0;
  const result = await runner.run({ jobId: 'job-ps', path: 'main.ps1', language: 'powershell' }, { root });
  assert.equal(result.status, 'JOB_STATUS_SUCCEEDED', result.errorMessage ?? result.stderr);
  assert.deepEqual(calls.map((call) => call.command), ['powershell']);
  assert.deepEqual(calls[0].args, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'main.ps1')]);

  // With no candidate installed the runtime is unavailable and keeps its primary
  // name, so the UI can still say what it looked for.
  const missing = createLocalRunner({
    spawnImpl: (command, args, options) => fakeSpawn({ error: 'ENOENT' }).spawnImpl(command, args, options),
    platform: 'win32',
  });
  const unavailable = (await missing.detect()).find((item) => item.language === 'powershell');
  assert.equal(unavailable.available, false);
  assert.equal(unavailable.command, 'pwsh');
});

test('detection reports which toolchains exist on this machine', async () => {
  const spawnImpl = (command, args, options) => {
    const plan = command === 'python' ? { code: 0 } : { error: 'ENOENT' };
    return fakeSpawn(plan).spawnImpl(command, args, options);
  };
  const runner = createLocalRunner({ spawnImpl });
  const detected = await runner.detect();
  const python = detected.find((entry) => entry.language === 'python');
  assert.equal(python.available, true);
  assert.equal(python.command, 'python');
  assert.deepEqual(python.extensions, ['.py', '.pyw']);
  assert.equal(detected.find((entry) => entry.language === 'go').available, false);
  assert.equal(detected.find((entry) => entry.language === 'rust').command, 'rustc');
  assert.equal((await runner.detect())[0].available, python.available);
});

test('a successful local run reports stdout, exit code, and timing', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sandkasten-run-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'main.py'), 'print("hello")\n');
  const { spawnImpl, calls } = fakeSpawn({ stdout: 'hello\n', code: 0 });
  const runner = createLocalRunner({ spawnImpl, platform: 'linux', tmpRoot: path.join(root, '.out') });
  const result = await runner.run({ jobId: 'job-ok', path: 'main.py', language: 'python' }, { root });
  assert.equal(result.status, 'JOB_STATUS_SUCCEEDED');
  assert.equal(result.stdout, 'hello\n');
  assert.equal(result.exitCode, 0);
  assert.equal(result.language, 'python');
  assert.equal(typeof result.durationMs, 'number');
  assert.equal(calls[0].command, 'python');
  assert.equal(calls[0].options.cwd, root);
  assert.equal(runner.activeRuns.size, 0);
});

test('a failing process and a failing compile are separated', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sandkasten-run-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'main.c'), 'int main(void) { return 1; }\n');

  const failed = createLocalRunner({ spawnImpl: fakeSpawn({ stderr: 'boom\n', code: 3 }).spawnImpl, platform: 'linux', tmpRoot: path.join(root, '.out') });
  const runtimeFailure = await failed.run({ jobId: 'job-fail', path: 'main.c', language: 'c' }, { root });
  assert.equal(runtimeFailure.status, 'JOB_STATUS_COMPILE_FAILED');
  assert.equal(runtimeFailure.compileStderr, 'boom\n');
  assert.equal(runtimeFailure.exitCode, 3);

  const succeed = createLocalRunner({ spawnImpl: fakeSpawn({ code: 0 }).spawnImpl, platform: 'linux', tmpRoot: path.join(root, '.out') });
  const compiled = await succeed.run({ jobId: 'job-c', path: 'main.c', language: 'c' }, { root });
  assert.equal(compiled.status, 'JOB_STATUS_SUCCEEDED');
  assert.equal(compiled.compileStdout, '');
});

test('local runs are bounded by a timeout and can be canceled', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sandkasten-run-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'main.py'), 'while True: pass\n');

  const holder = fakeSpawn({ hold: true });
  const timeoutRunner = createLocalRunner({ spawnImpl: holder.spawnImpl, platform: 'linux', tmpRoot: path.join(root, '.out') });
  const timedOut = await timeoutRunner.run({ jobId: 'job-slow', path: 'main.py', language: 'python', timeoutMs: 1000 }, { root });
  assert.equal(timedOut.status, 'JOB_STATUS_TIME_LIMIT_EXCEEDED');
  assert.match(timedOut.errorMessage, /time limit/);

  const cancelHolder = fakeSpawn({ hold: true });
  const cancelRunner = createLocalRunner({ spawnImpl: cancelHolder.spawnImpl, platform: 'linux', tmpRoot: path.join(root, '.out') });
  const pending = cancelRunner.run({ jobId: 'job-cancel', path: 'main.py', language: 'python', timeoutMs: 30_000 }, { root });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await cancelRunner.stop('job-cancel'), true);
  const canceled = await pending;
  assert.equal(canceled.status, 'JOB_STATUS_CANCELED');
  assert.equal(await cancelRunner.stop('job-missing'), false);
});

test('output beyond the configured limit is truncated', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sandkasten-run-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'main.py'), 'print("x" * 100)\n');
  const runner = createLocalRunner({
    spawnImpl: fakeSpawn({ stdout: 'x'.repeat(400), code: 0 }).spawnImpl,
    platform: 'linux',
    tmpRoot: path.join(root, '.out'),
    maxOutputBytes: 100,
  });
  const result = await runner.run({ jobId: 'job-big', path: 'main.py', language: 'python' }, { root });
  assert.equal(result.status, 'JOB_STATUS_OUTPUT_LIMIT_EXCEEDED');
  assert.equal(result.stdout.length, 100);
  assert.equal(result.truncated.stdout, true);
});

test('a missing workspace file or folder is rejected before spawning', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sandkasten-run-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runner = createLocalRunner({ spawnImpl: fakeSpawn({ code: 0 }).spawnImpl });
  await assert.rejects(() => runner.run({ jobId: 'job-x', path: 'missing.py', language: 'python' }, { root }), /not found/);
  await assert.rejects(() => runner.run({ jobId: 'job-x', path: '../escape.py', language: 'python' }, { root }), /workspace/i);
  await assert.rejects(() => runner.run({ jobId: 'job-x', path: 'main.py', language: 'python' }, {}), /open a workspace folder/i);
});

test('a hung toolchain probe is bounded and reported as unavailable', async () => {
  const spawned = [];
  const spawnImpl = (command, args, options) => {
    const plan = command === 'python' ? { hold: true } : { error: 'ENOENT' };
    const child = fakeSpawn(plan).spawnImpl(command, args, options);
    spawned.push(child);
    return child;
  };
  const runner = createLocalRunner({ spawnImpl, probeTimeoutMs: 150 });
  const started = Date.now();
  const detected = await runner.detect();
  const elapsed = Date.now() - started;
  assert.equal(detected.find((entry) => entry.language === 'python').available, false);
  assert.ok(elapsed < 3_000, `detection must not wait for the hung probe (took ${elapsed} ms)`);
  assert.equal(spawned[0].killedWith, 'SIGKILL', 'the hung probe must be killed');
});

test('a real toolchain runs a real file end to end', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sandkasten-real-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'main.py'), 'print("sandkasten-local-run-ok")\n');

  const runner = createLocalRunner();
  const detected = await runner.detect();
  const python = detected.find((entry) => entry.language === 'python');
  if (!python?.available) {
    t.skip('python is not installed on this machine');
    return;
  }

  const result = await runner.run({ jobId: 'job-real', path: 'main.py', language: 'python' }, { root });
  assert.equal(result.status, 'JOB_STATUS_SUCCEEDED', result.errorMessage ?? result.stderr);
  assert.match(result.stdout, /sandkasten-local-run-ok/);
  assert.equal(result.exitCode, 0);
});