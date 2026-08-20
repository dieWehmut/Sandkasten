import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

import * as client from './app.js';

const { loadRuntimes, pollJob, renderResult, submitJob } = client;

const root = path.dirname(fileURLToPath(import.meta.url));

test('static WebUI client files exist and declare the same-origin job contract', () => {
  for (const file of ['index.html', 'config.js', 'app.js', 'styles.css']) {
    assert.equal(fs.existsSync(path.join(root, file)), true, `${file} should exist`);
  }

  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

  assert.match(html, /runtime-select/);
  assert.match(html, /source/);
  assert.match(html, /output/);
  assert.match(html, />Stop polling</);
  assert.doesNotMatch(html, />Cancel job</);
  assert.match(app, /\/v1\/runtimes/);
  assert.match(app, /\/v1\//);
  assert.match(app, /\/v1\/jobs\//);
  assert.match(app, /Polling stopped/);
  assert.match(app, /textContent/);
  assert.match(styles, /@media/);
});

test('runtime config defaults to same-origin without replacing an existing config', () => {
  const source = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
  const defaultContext = {};
  vm.runInNewContext(source, defaultContext);
  assert.equal(defaultContext.SANDKASTEN_CONFIG.apiBaseUrl, '');

  const configured = { apiBaseUrl: 'https://api.example.com/base/' };
  const configuredContext = { SANDKASTEN_CONFIG: configured };
  vm.runInNewContext(source, configuredContext);
  assert.equal(configuredContext.SANDKASTEN_CONFIG, configured);
});

test('index loads runtime config before the WebUI module', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const configPosition = html.indexOf('src="./config.js"');
  const appPosition = html.indexOf('src="./app.js"');
  assert.notEqual(configPosition, -1);
  assert.ok(configPosition < appPosition);
});

test('API URL resolver keeps API paths same-origin by default', () => {
  assert.equal(client.resolveApiUrl('/v1/runtimes', { apiBaseUrl: '' }), '/v1/runtimes');
});

test('API URL resolver joins an absolute base without duplicate slashes', () => {
  assert.equal(
    client.resolveApiUrl('/v1/runtimes', { apiBaseUrl: 'https://api.example.com/base/' }),
    'https://api.example.com/base/v1/runtimes',
  );
});

test('runtime, submission, and polling requests honor the configured API base', async () => {
  const previousConfig = globalThis.SANDKASTEN_CONFIG;
  const hadConfig = Object.hasOwn(globalThis, 'SANDKASTEN_CONFIG');
  globalThis.SANDKASTEN_CONFIG = { apiBaseUrl: 'https://api.example.com/base/' };
  const urls = [];
  const responses = [
    { runtimes: [{ language: 'go' }] },
    { jobId: 'job-1' },
    { jobId: 'job-1', status: 'JOB_STATUS_SUCCEEDED' },
  ];
  const fetchImpl = async (url) => {
    urls.push(url);
    return { ok: true, json: async () => responses.shift() };
  };

  try {
    await loadRuntimes(fetchImpl);
    await submitJob('go', 'package main', fetchImpl);
    await pollJob('job-1', { fetchImpl, intervalMs: 0 });
  } finally {
    if (hadConfig) globalThis.SANDKASTEN_CONFIG = previousConfig;
    else delete globalThis.SANDKASTEN_CONFIG;
  }

  assert.deepEqual(urls, [
    'https://api.example.com/base/v1/runtimes',
    'https://api.example.com/base/v1/go/run',
    'https://api.example.com/base/v1/jobs/job-1',
  ]);
});

test('polling stops for every terminal status exposed by the API', async () => {
  const terminalStatuses = [
    'JOB_STATUS_SUCCEEDED',
    'JOB_STATUS_COMPILE_FAILED',
    'JOB_STATUS_RUNTIME_FAILED',
    'JOB_STATUS_TIME_LIMIT_EXCEEDED',
    'JOB_STATUS_MEMORY_LIMIT_EXCEEDED',
    'JOB_STATUS_OUTPUT_LIMIT_EXCEEDED',
    'JOB_STATUS_CANCELED',
    'JOB_STATUS_SYSTEM_ERROR',
  ];

  for (const status of terminalStatuses) {
    let requests = 0;
    const result = await pollJob('job-1', {
      intervalMs: 0,
      fetchImpl: async () => {
        requests += 1;
        if (requests > 1) throw new Error(`polled again after terminal status ${status}`);
        return { ok: true, json: async () => ({ jobId: 'job-1', status }) };
      },
    });
    assert.equal(result.status, status);
    assert.equal(requests, 1);
  }
});

test('HTTP errors prefer the server message over its machine-readable code', async () => {
  await assert.rejects(
    submitJob('go', 'package main', async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_request', message: 'source archive is invalid' }),
    })),
    /source archive is invalid/,
  );
});

test('job rendering surfaces the terminal error message', () => {
  const elements = {
    status: { textContent: '' },
    stdout: { textContent: '' },
    stderr: { textContent: '' },
    diagnostics: { textContent: '' },
  };
  renderResult({
    status: 'JOB_STATUS_RUNTIME_FAILED',
    stdout: '',
    stderr: '',
    compileStderr: '',
    errorMessage: 'process exited with status 1',
    diagnostics: {},
  }, elements);
  assert.match(elements.diagnostics.textContent, /process exited with status 1/);
});
