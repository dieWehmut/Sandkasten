import { describe, expect, test } from 'vitest';
import { runProblemCounts } from '../src/state/diagnostics';
import type { JobResponse } from '../src/services/sandkastenApi';

function job(overrides: Partial<JobResponse> = {}): JobResponse {
  return { jobId: 'job-1', status: 'JOB_STATUS_SUCCEEDED', ...overrides };
}

describe('status bar problem counts', () => {
  test('stays empty before the first run and after a clean one', () => {
    expect(runProblemCounts()).toEqual({ errors: 0, warnings: 0 });
    expect(runProblemCounts(job({ stdout: 'hi\n' }))).toEqual({ errors: 0, warnings: 0 });
  });

  test('counts a failed request and a failed run as one error', () => {
    expect(runProblemCounts(undefined, 'API request failed')).toEqual({ errors: 1, warnings: 0 });
    expect(runProblemCounts(job({ status: 'JOB_STATUS_RUNTIME_FAILED' }))).toEqual({ errors: 1, warnings: 0 });
    expect(runProblemCounts(job({ status: 'JOB_STATUS_COMPILE_FAILED', errorMessage: 'boom' }))).toEqual({ errors: 1, warnings: 0 });
    expect(runProblemCounts(job({ status: 'JOB_STATUS_SYSTEM_ERROR' }))).toEqual({ errors: 1, warnings: 0 });
  });

  test('counts warning lines and a limit stop as warnings', () => {
    expect(runProblemCounts(job({ stderr: 'main.py:3: warning: unused name\n' }))).toEqual({ errors: 0, warnings: 1 });
    expect(runProblemCounts(job({ stderr: 'warning: one\nwarning: two\n' }))).toEqual({ errors: 0, warnings: 2 });
    // Warnings also arrive on the compile channel, and a stopped run is neither
    // an error nor a warning.
    expect(runProblemCounts(job({ compileStderr: 'warning: deprecated\n' }))).toEqual({ errors: 0, warnings: 1 });
    expect(runProblemCounts(job({ status: 'JOB_STATUS_CANCELED' }))).toEqual({ errors: 0, warnings: 0 });
    expect(runProblemCounts(job({ status: 'JOB_STATUS_TIME_LIMIT_EXCEEDED' }))).toEqual({ errors: 0, warnings: 1 });
  });

  test('counts base64 output from its decoded text', () => {
    const stderr = Buffer.from('c: warning: signed compare\n', 'utf8').toString('base64');
    expect(runProblemCounts(job({ stderr, stderrEncoding: 'base64' }))).toEqual({ errors: 0, warnings: 1 });
    // Undecodable payloads fall back to the raw text rather than throwing.
    expect(runProblemCounts(job({ stderr: 'not base64', stderrEncoding: 'base64' }))).toEqual({ errors: 0, warnings: 0 });
  });
});