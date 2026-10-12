import assert from 'node:assert/strict';
import test from 'node:test';

import { discoverTerminalProfileReport } from '../src/terminal-profiles.mjs';
import {
  shellMarkerVerdict,
  shellPathProbeVerdict,
  shellSampleVerdict,
  shellSelfReportVerdict,
  verifyShells,
} from '../scripts/verify-shells.mjs';

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

test('the marker verdict needs the marker, not just a clean exit', () => {
  assert.deepEqual(shellMarkerVerdict({ ok: true, stdout: 'SANDKASTEN_SHELL_OK\n' }), { ok: true, reason: '' });
  assert.deepEqual(shellMarkerVerdict({ ok: true, stdout: 'something else\n' }), { ok: false, reason: 'marker missing from output' });
  assert.deepEqual(shellMarkerVerdict({ ok: false, stdout: '', reason: 'timed out after 30000 ms' }), { ok: false, reason: 'timed out after 30000 ms' });
  assert.equal(shellMarkerVerdict(undefined).ok, false);
});

test('a shell that reports commands has to find them in the list it publishes', () => {
  const published = ['git', 'Get-ChildItem', 'Get-Content'];
  // Both kinds present: nothing to say.
  assert.deepEqual(shellSelfReportVerdict({ reportedNames: new Set(['Get-ChildItem', 'Get-Content']), published }),
    { reason: '', selfReported: 2, first: 'Get-ChildItem' });
  // The list carries none of them — the cmdlets are missing entirely.
  assert.match(shellSelfReportVerdict({ reportedNames: new Set(['Where-Object']), published }).reason,
    /carries none of the commands the shell reports/);
  // The list was cut while it was still under its bound.
  const truncated = shellSelfReportVerdict({ reportedNames: new Set(['Get-ChildItem', 'Get-Content', 'Get-Help']), published });
  assert.match(truncated.reason, /only 2 of 3 shell-reported commands reached the list/);
  // At the bound, dropping the tail is expected rather than a defect.
  const atBound = shellSelfReportVerdict({
    reportedNames: new Set(['a', 'b', 'left-out']),
    published: ['a', 'b', 'c', 'd', 'e'],
    limit: 5,
  });
  assert.equal(atBound.reason, '');
  assert.equal(atBound.selfReported, 2);
  // A shell that reports nothing about itself is not part of this check.
  assert.deepEqual(shellSelfReportVerdict({ reportedNames: null, published }), { reason: '', selfReported: 0, first: undefined });
});

test('advertised commands that none of which resolve are a failure', () => {
  assert.deepEqual(shellSampleVerdict(['git', 'ls'], ['git']), { reason: '' });
  assert.deepEqual(shellSampleVerdict([], []), { reason: '' });
  assert.match(shellSampleVerdict(['git', 'ls'], []).reason, /resolves none of its advertised commands \(git, ls\)/);
});

test('the path probe needs its marker, from a command that actually ran', () => {
  assert.deepEqual(shellPathProbeVerdict({ ok: true, stdout: 'SANDKASTEN_PATH_OK\n' }), { pathProbe: 'reachable', reason: '' });
  // A shell that ran the probe but never printed the marker.
  assert.deepEqual(shellPathProbeVerdict({ ok: true, stdout: '' }),
    { pathProbe: 'unreachable', reason: 'the probe command did not print its marker' });
  // A shell that could not run it at all says why.
  assert.deepEqual(shellPathProbeVerdict({ ok: false, stdout: '', reason: 'timed out after 30000 ms' }),
    { pathProbe: 'unreachable', reason: 'the probe command could not run (timed out after 30000 ms)' });
  assert.equal(shellPathProbeVerdict(undefined).pathProbe, 'unreachable');
});