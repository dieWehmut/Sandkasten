import assert from 'node:assert/strict';
import test from 'node:test';

import { cancellationVerdict, isolationFailureVerdict, isolationFixtureVerdict, languageVerdict, outputLimitVerdict, timeLimitVerdict } from '../scripts/verify-isolated.mjs';

// The isolation check found three real defects by probe: host files readable, a
// cancelled payload still running, and an output limit that did not stop the
// program. These are the verdicts that caught them, tested without a distro.

const succeeded = (stdout) => ({ status: 'JOB_STATUS_SUCCEEDED', stdout, errorMessage: '' });

test('a language fixture passes on its marker and fails without it', () => {
  assert.deepEqual(languageVerdict(succeeded('SANDKASTEN_ISOLATED_OK:python\n'), 'SANDKASTEN_ISOLATED_OK:python'), { ok: true, reason: '' });
  assert.equal(languageVerdict(succeeded('nothing\n'), 'SANDKASTEN_ISOLATED_OK:python').ok, false);
  assert.match(languageVerdict({ status: 'JOB_STATUS_RUNTIME_FAILED', stdout: '', errorMessage: 'boom' }, 'x').reason, /boom/);
});

test('reading the host filesystem is a failure, and hiding it is not', () => {
  const host = { id: 'host-files', expect: 'HOSTFILES=' };
  const visible = isolationFixtureVerdict(host, succeeded('HOSTFILES=visible\n'), { hostFiles: 'visible' });
  assert.equal(visible.ok, false);
  assert.match(visible.reason, /still read the host filesystem/);

  const hidden = isolationFixtureVerdict(host, succeeded('HOSTFILES=hidden\n'), { hostFiles: 'hidden' });
  assert.deepEqual(hidden, { ok: true, reason: '', note: 'the host filesystem is out of reach' });
});

test('seeing the host process table is a failure', () => {
  const processes = { id: 'processes', expect: 'PID1=' };
  assert.equal(isolationFixtureVerdict(processes, succeeded('PID1=init\nPROCS=200\n'), { pid1: 'init', processes: 200 }).ok, false);
  assert.equal(isolationFixtureVerdict(processes, succeeded('PID1=python3\nPROCS=0\n'), { pid1: 'python3', processes: 0 }).ok, false);
  assert.equal(isolationFixtureVerdict(processes, succeeded('PID1=python3\nPROCS=61\n'), { pid1: 'python3', processes: 61 }).ok, true);
});

test('a cancellation only passes when the payload really died', () => {
  assert.deepEqual(cancellationVerdict({ running: 2, status: 'JOB_STATUS_CANCELED', left: 0 }),
    { ok: true, reason: '', note: 'stopped 2 process(es) and left nothing running' });
  // The three ways the check has caught the sandbox leaking.
  assert.equal(cancellationVerdict({ running: 0, status: 'JOB_STATUS_CANCELED', left: 0 }).ok, false);
  assert.equal(cancellationVerdict({ running: 2, status: 'JOB_STATUS_SUCCEEDED', left: 0 }).ok, false);
  const leaked = cancellationVerdict({ running: 2, status: 'JOB_STATUS_CANCELED', left: 1 });
  assert.equal(leaked.ok, false);
  assert.match(leaked.reason, /kept running after the cancellation/);
});

test('an output limit only passes when the flood was stopped', () => {
  assert.deepEqual(outputLimitVerdict({ status: 'JOB_STATUS_OUTPUT_LIMIT_EXCEEDED', left: 0, kept: 16384, durationMs: 1700 }),
    { ok: true, reason: '', note: 'stopped at 16384 characters and left nothing running' });
  // Running to the time limit instead is exactly what the fix addressed.
  const slow = outputLimitVerdict({ status: 'JOB_STATUS_TIME_LIMIT_EXCEEDED', left: 0, kept: 45048, durationMs: 62_000 });
  assert.equal(slow.ok, false);
  assert.match(slow.reason, /reported JOB_STATUS_TIME_LIMIT_EXCEEDED after 62000 ms/);
  assert.equal(outputLimitVerdict({ status: 'JOB_STATUS_OUTPUT_LIMIT_EXCEEDED', left: 3, kept: 100, durationMs: 900 }).ok, false);
});

test('a payload that fails has to be reported as a failure, with its own words', () => {
  const failing = {
    status: 'JOB_STATUS_RUNTIME_FAILED', exitCode: 3,
    stdout: 'SANDKASTEN_ISOLATED_FAILED\n', stderr: 'SANDKASTEN_ISOLATED_STDERR\n', left: 0,
  };
  assert.deepEqual(isolationFailureVerdict(failing),
    { ok: true, reason: '', note: 'reported as a failure with exit code 3' });

  // Every way the report can go wrong is a failure of the check, not a pass.
  assert.match(isolationFailureVerdict({ ...failing, status: 'JOB_STATUS_SUCCEEDED' }).reason, /was reported as JOB_STATUS_SUCCEEDED/);
  assert.match(isolationFailureVerdict({ ...failing, exitCode: 0 }).reason, /carries exit code 0/);
  assert.match(isolationFailureVerdict({ ...failing, stdout: '' }).reason, /output was not kept/);
  assert.match(isolationFailureVerdict({ ...failing, stderr: '' }).reason, /error output was not kept/);
  assert.match(isolationFailureVerdict({ ...failing, left: 2 }).reason, /2 process\(es\) kept running/);
});

test('a payload past its time limit is a timeout, and nothing is left behind', () => {
  const timedOut = {
    status: 'JOB_STATUS_TIME_LIMIT_EXCEEDED', left: 0, stdout: 'SANDKASTEN_TIME_LIMIT_READY\n',
    durationMs: 4_200, limitMs: 4_000,
  };
  assert.deepEqual(timeLimitVerdict(timedOut),
    { ok: true, reason: '', note: 'stopped after 4200 ms, its own limit being 4000 ms' });

  assert.match(timeLimitVerdict({ ...timedOut, status: 'JOB_STATUS_SUCCEEDED' }).reason, /past its 4000 ms limit reported JOB_STATUS_SUCCEEDED/);
  assert.match(timeLimitVerdict({ ...timedOut, stdout: '' }).reason, /never ran/);
  assert.match(timeLimitVerdict({ ...timedOut, left: 1 }).reason, /1 process\(es\) kept running/);
  // A run that took far longer than the limit it was given means the limit did not
  // apply — the payload would otherwise have run for two minutes.
  assert.match(timeLimitVerdict({ ...timedOut, durationMs: 90_000 }).reason, /took 90000 ms to apply/);
});