import assert from 'node:assert/strict';
import test from 'node:test';

import { discoverTerminalProfileReport } from '../src/terminal-profiles.mjs';
import { verifyShells } from '../scripts/verify-shells.mjs';

// The check exists to fail when a shell cannot do what the terminal promises. An
// injected profile is how these tests make that happen on purpose.

test('a shell that is not installed is reported as failed, with the reason', async () => {
  const report = await verifyShells({
    checkPath: false,
    profiles: [{ id: 'ghost', label: 'Ghost', family: 'posix', executable: '/nonexistent/sandkasten-shell', args: [], pathPrepend: [] }],
  });

  assert.equal(report.results.length, 1);
  const [row] = report.results;
  assert.equal(row.status, 'failed');
  assert.match(row.reason, /ENOENT|not found|no such file/i);
  assert.equal(row.pathProbe, 'not-checked');
});

test('a program that cannot run the marker command is reported as failed', async () => {
  // Node is a real executable that is not a shell: asked for a one-shot command
  // the way a POSIX shell would be, it exits non-zero without the marker.
  const report = await verifyShells({
    checkPath: false,
    profiles: [{ id: 'not-a-shell', label: 'Not a shell', family: 'posix', executable: process.execPath, args: [], pathPrepend: [] }],
  });

  const [row] = report.results;
  assert.equal(row.status, 'failed');
  assert.doesNotMatch(row.reason ?? '', /^$/, 'a failure has to say why');
});

test('the shells this machine really has pass the same check', async () => {
  const { profiles } = await discoverTerminalProfileReport();
  // A quick shell, not the first one: PowerShell publishes a few thousand
  // commands and the point here is the check, not the list.
  const profile = profiles.find((entry) => entry.family === 'cmd')
    ?? profiles.find((entry) => entry.family === 'bash')
    ?? profiles[0];
  const report = await verifyShells({ checkPath: false, profiles: [profile] });

  assert.equal(report.results.length, 1);
  assert.equal(report.results[0].status, 'ok', `expected ${report.results[0].label} to pass: ${report.results[0].reason}`);
  assert.equal(report.results[0].resolved.length > 0, true, 'the advertised list has to be one the shell runs');
});

test('an injected run reports no missing shells, because nothing was looked for', async () => {
  const report = await verifyShells({
    checkPath: false,
    profiles: [{ id: 'ghost', label: 'Ghost', family: 'posix', executable: '/nonexistent/sandkasten-shell', args: [], pathPrepend: [] }],
  });
  assert.deepEqual(report.missing, []);
});