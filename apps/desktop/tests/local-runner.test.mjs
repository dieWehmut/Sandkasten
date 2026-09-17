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

  const go = resolveLocalPlan('go', { filePath: path.resolve('/ws/main.go'), jobId: 'job-3' });
  assert.deepEqual(go.run.args.slice(0, 1), ['run']);

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