import assert from 'node:assert/strict';
import test from 'node:test';

import { formatJobHuman, formatJobJson, formatRuntimesHuman, failedStatusExitCode, jobExitCode } from '../src/output.mjs';

const job = {
  jobId: 'job-1',
  status: 'JOB_STATUS_SUCCEEDED',
  language: 'python',
  stdout: 'hello\n',
  stderr: '',
  exitCode: 0,
  durationMs: 12,
};

test('prints runtimes as a table with aliases and entrypoints', () => {
  const text = formatRuntimesHuman([
    { language: 'python', aliases: ['py', 'python3'], default_entrypoint: 'main.py', version: '3.12' },
    { language: 'go', aliases: [], default_entrypoint: '.' },
  ]);
  assert.match(text, /python/);
  assert.match(text, /py, python3/);
  assert.match(text, /main\.py/);
  assert.match(text, /go/);
});

test('prints job results with status, exit code, and separated streams', () => {
  const text = formatJobHuman(job);
  assert.match(text, /JOB_STATUS_SUCCEEDED/);
  assert.match(text, /exit code: 0/);
  assert.match(text, /hello/);
});

test('emits stable machine-readable JSON', () => {
  const parsed = JSON.parse(formatJobJson(job));
  assert.equal(parsed.jobId, 'job-1');
  assert.equal(parsed.status, 'JOB_STATUS_SUCCEEDED');
  assert.equal(parsed.stdout, 'hello\n');
});

test('maps terminal statuses to exit codes', () => {
  assert.equal(jobExitCode({ status: 'JOB_STATUS_SUCCEEDED' }), 0);
  assert.equal(jobExitCode({ status: 'JOB_STATUS_COMPILE_FAILED' }), 1);
  assert.equal(jobExitCode({ status: 'JOB_STATUS_RUNTIME_FAILED' }), 1);
  assert.equal(jobExitCode({ status: 'JOB_STATUS_TIME_LIMIT_EXCEEDED' }), 1);
  assert.equal(failedStatusExitCode({ status: 'JOB_STATUS_SUCCEEDED' }), 0);
});
