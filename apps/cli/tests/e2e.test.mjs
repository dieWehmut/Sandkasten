import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const binPath = fileURLToPath(new URL('../bin/sandkasten.mjs', import.meta.url));

function createMockApi({ jobSequence = ['JOB_STATUS_RUNNING', 'JOB_STATUS_SUCCEEDED'] } = {}) {
  const requests = [];
  let polls = 0;
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
      requests.push({ body, method: request.method, url: request.url, authorization: request.headers.authorization });

      const json = (status, payload) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(payload));
      };

      if (request.url === '/v1/runtimes') {
        json(200, { runtimes: [{ language: 'python', aliases: ['py'], default_entrypoint: 'main.py', version: '3.12' }] });
        return;
      }
      if (request.url?.startsWith('/v1/python/run')) {
        json(200, { jobId: 'job-1', status: 'JOB_STATUS_QUEUED' });
        return;
      }
      if (request.url?.startsWith('/v1/jobs/job-1')) {
        const status = jobSequence[Math.min(polls, jobSequence.length - 1)];
        polls += 1;
        if (status === 'JOB_STATUS_SUCCEEDED') {
          json(200, { jobId: 'job-1', status, language: 'python', stdout: 'hello\n', stderr: '', exitCode: 0, durationMs: 5 });
        } else {
          json(200, { jobId: 'job-1', status, language: 'python' });
        }
        return;
      }
      json(404, { error: 'not_found', message: `unknown path: ${request.url}` });
    });
  });
  return { server, requests };
}

async function startMockApi(options) {
  const mock = createMockApi(options);
  mock.server.listen(0, '127.0.0.1');
  await once(mock.server, 'listening');
  mock.origin = `http://127.0.0.1:${mock.server.address().port}`;
  return mock;
}

function runCli(args, environment = {}) {
  const child = spawn(process.execPath, [binPath, ...args], {
    env: { ...process.env, ...environment },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return new Promise((resolve) => {
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('runtimes prints a table and exits 0', async () => {
  const mock = await startMockApi();
  try {
    const result = await runCli(['runtimes', '--api', mock.origin]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /python/);
    assert.match(result.stdout, /py/);
  } finally {
    mock.server.close();
  }
});

test('runtimes --json emits the raw manifest and sends the bearer token', async () => {
  const mock = await startMockApi();
  try {
    const result = await runCli(['runtimes', '--api', mock.origin, '--token', 'secret', '--json']);
    assert.equal(result.code, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed[0].language, 'python');
    assert.equal(mock.requests[0].authorization, 'Bearer secret');
  } finally {
    mock.server.close();
  }
});

test('run submits, polls to a terminal status, and prints output', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'sandkasten-cli-'));
  const file = path.join(directory, 'main.py');
  await writeFile(file, 'print("hello")\n');
  const mock = await startMockApi();
  try {
    const result = await runCli(['run', file, '--api', mock.origin, '--poll-interval', '25']);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /JOB_STATUS_SUCCEEDED/);
    assert.match(result.stdout, /hello/);
    assert.match(result.stderr, /submitted job-1/);
    const submission = mock.requests.find((request) => request.url === '/v1/python/run');
    assert.deepEqual(submission.body, { source: 'print("hello")\n', wait: false });
  } finally {
    mock.server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('a failed job exits 1 and reports the status', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'sandkasten-cli-'));
  const file = path.join(directory, 'main.py');
  await writeFile(file, 'boom\n');
  const mock = await startMockApi({ jobSequence: ['JOB_STATUS_COMPILE_FAILED'] });
  try {
    const result = await runCli(['run', file, '--language', 'python', '--api', mock.origin, '--poll-interval', '25']);
    assert.equal(result.code, 1);
    assert.match(result.stdout, /JOB_STATUS_COMPILE_FAILED/);
  } finally {
    mock.server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('usage errors exit 2 and unreachable APIs exit 3', async () => {
  const usage = await runCli(['frobnicate']);
  assert.equal(usage.code, 2);
  assert.match(usage.stderr, /unknown command/i);

  const missing = await runCli(['run']);
  assert.equal(missing.code, 2);

  const unreadable = await runCli(['run', 'does-not-exist.py', '--api', 'http://127.0.0.1:1']);
  assert.equal(unreadable.code, 2);
  assert.match(unreadable.stderr, /cannot read source file/i);

  const unreachable = await runCli(['runtimes', '--api', 'http://127.0.0.1:1']);
  assert.equal(unreachable.code, 3);
  assert.match(unreachable.stderr, /cannot reach/i);
});

test('job fetches an existing job without submitting', async () => {
  const mock = await startMockApi({ jobSequence: ['JOB_STATUS_SUCCEEDED'] });
  try {
    const result = await runCli(['job', 'job-1', '--api', mock.origin]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /job-1/);
    assert.equal(mock.requests.some((request) => request.method === 'POST'), false);
  } finally {
    mock.server.close();
  }
});
