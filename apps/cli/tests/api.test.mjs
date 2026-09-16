import assert from 'node:assert/strict';
import test from 'node:test';

import { buildHeaders, resolveApiUrl, TERMINAL_STATUSES } from '../src/api.mjs';

test('resolves API paths against defaults, base URLs, and path prefixes', () => {
  assert.equal(resolveApiUrl('/v1/runtimes', {}), '/v1/runtimes');
  assert.equal(resolveApiUrl('/v1/runtimes', { apiBaseUrl: 'https://run.example.com' }), 'https://run.example.com/v1/runtimes');
  assert.equal(resolveApiUrl('/v1/runtimes', { apiBaseUrl: 'https://run.example.com/prefix/' }), 'https://run.example.com/prefix/v1/runtimes');
  assert.equal(resolveApiUrl('v1/jobs/a%2Fb', { apiBaseUrl: 'http://127.0.0.1:8080/' }), 'http://127.0.0.1:8080/v1/jobs/a%2Fb');
});

test('builds JSON headers and optional bearer tokens', () => {
  const headers = buildHeaders({ token: 'secret' });
  assert.equal(headers.Accept, 'application/json');
  assert.equal(headers['Content-Type'], 'application/json');
  assert.equal(headers.Authorization, 'Bearer secret');
  const anonymous = buildHeaders({});
  assert.equal(anonymous.Authorization, undefined);
  const custom = buildHeaders({ token: 'x', headers: { 'X-Trace': '1' } });
  assert.equal(custom['X-Trace'], '1');
});

test('exposes exactly the eight terminal statuses', () => {
  assert.deepEqual([...TERMINAL_STATUSES].sort(), [
    'JOB_STATUS_CANCELED',
    'JOB_STATUS_COMPILE_FAILED',
    'JOB_STATUS_MEMORY_LIMIT_EXCEEDED',
    'JOB_STATUS_OUTPUT_LIMIT_EXCEEDED',
    'JOB_STATUS_RUNTIME_FAILED',
    'JOB_STATUS_SUCCEEDED',
    'JOB_STATUS_SYSTEM_ERROR',
    'JOB_STATUS_TIME_LIMIT_EXCEEDED',
  ]);
});
