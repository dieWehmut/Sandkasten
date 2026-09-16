import assert from 'node:assert/strict';
import test from 'node:test';

import { parseArgs, usage } from '../src/args.mjs';

test('parses run with file, language, and API options', () => {
  const parsed = parseArgs(['run', 'main.py', '--language', 'python', '--api', 'https://run.example.com', '--token', 'secret', '--poll-interval', '250', '--json']);
  assert.equal(parsed.command, 'run');
  assert.equal(parsed.file, 'main.py');
  assert.deepEqual(parsed.options, {
    language: 'python',
    api: 'https://run.example.com',
    token: 'secret',
    entrypoint: undefined,
    stdin: undefined,
    pollIntervalMs: 250,
    json: true,
  });
});

test('parses runtimes and job commands', () => {
  assert.equal(parseArgs(['runtimes']).command, 'runtimes');
  const job = parseArgs(['job', 'abc-123']);
  assert.equal(job.command, 'job');
  assert.equal(job.jobId, 'abc-123');
});

test('requires a file for run and a job id for job', () => {
  assert.throws(() => parseArgs(['run']), /usage/i);
  assert.throws(() => parseArgs(['job']), /usage/i);
});

test('falls back to environment defaults', () => {
  const parsed = parseArgs(['run', 'main.go'], {
    SANDKASTEN_API_BASE_URL: 'http://127.0.0.1:8080',
    SANDKASTEN_API_TOKEN: 'env-token',
  });
  assert.equal(parsed.options.api, 'http://127.0.0.1:8080');
  assert.equal(parsed.options.token, 'env-token');
  assert.equal(parsed.options.language, undefined);
  assert.equal(parsed.options.pollIntervalMs, 1000);
});

test('rejects unknown commands, flags, and missing values', () => {
  assert.throws(() => parseArgs(['frobnicate']), /usage/i);
  assert.throws(() => parseArgs(['runtimes', '--nope']), /unknown option/i);
  assert.throws(() => parseArgs(['run', 'a.py', '--language']), /requires a value/i);
  assert.throws(() => parseArgs(['run', 'a.py', '--poll-interval', 'abc']), /poll-interval/i);
});

test('usage names every supported command', () => {
  const text = usage();
  for (const fragment of ['run', 'runtimes', 'job', '--language', '--api', '--token', '--json']) {
    assert.ok(text.includes(fragment), `usage must mention ${fragment}`);
  }
});
