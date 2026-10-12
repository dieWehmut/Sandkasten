#!/usr/bin/env node
// Verify the shells this machine offers. For every discovered profile this
// asks the shell for a one-shot marker command, and then proves that the
// session environment really reaches the shell: a probe command is written into
// a directory that is added to the profile's command path, and the shell has to
// find and run it. Exits non-zero when an installed shell fails.
//
//   node scripts/verify-shells.mjs [--json] [--profile=<id>] [--timeout-ms=15000]
import { spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { discoverTerminalProfileReport } from '../src/terminal-profiles.mjs';
import { TERMINAL_COMMAND_LIMITS, discoverTerminalCommands, shellReportCommand } from '../src/terminal-commands.mjs';
import { sessionEnvironment } from '../src/terminal.mjs';

const MARKER = 'SANDKASTEN_SHELL_OK';
const PATH_MARKER = 'SANDKASTEN_PATH_OK';
// A WSL session may have to cold-start a distro before it can answer, so the
// verification budget is far larger than an interactive prompt would need.
const DEFAULT_TIMEOUT_MS = 30_000;
// Starting a distro is the one step here that can outlast an idle budget.
const WSL_PROFILE_TIMEOUT_MS = 60_000;

// Each family gets the flag that runs one command and exits: PowerShell's
// -Command, cmd's /c, and -c for bash, the POSIX shells and NuShell. WSL runs
// the command through the distro's sh so the marker is not interpreted by the
// Windows launcher.
function oneShot(profile, command) {
  switch (profile.family) {
    case 'powershell': return ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command];
    case 'cmd': return ['/d', '/c', command];
    case 'wsl': return ['-e', 'sh', '-c', command];
    default: return ['-c', command];
  }
}

function probe(profile, command, { timeoutMs, environment }) {
  const args = oneShot(profile, command);
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let child;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, durationMs: Date.now() - started, stdout, stderr });
    };
    const timer = setTimeout(() => {
      try { child?.kill('SIGKILL'); } catch { /* already gone */ }
      finish({ ok: false, reason: `timed out after ${timeoutMs} ms` });
    }, timeoutMs);
    try {
      child = spawn(profile.executable, args, {
        windowsHide: true, cwd: process.cwd(), env: environment, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      finish({ ok: false, reason: error instanceof Error ? error.message : String(error) });
      return;
    }
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => finish({ ok: false, reason: error.message }));
    child.on('close', (code) => finish({ ok: code === 0, exitCode: code ?? undefined, reason: code === 0 ? '' : `exit code ${code}` }));
  });
}

// A Windows shell resolves `sandkasten-path-probe` through PATHEXT to the .cmd,
// a POSIX shell runs the extension-less script.
function createCommandProbe(platform = process.platform) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'sandkasten-shell-path-'));
  const name = 'sandkasten-path-probe';
  writeFileSync(path.join(directory, `${name}.cmd`), `@echo off\r\necho ${PATH_MARKER}\r\n`);
  const script = path.join(directory, name);
  writeFileSync(script, `#!/bin/sh\necho ${PATH_MARKER}\n`);
  if (platform !== 'win32') chmodSync(script, 0o755);
  return { directory, command: name, dispose: () => rmSync(directory, { recursive: true, force: true }) };
}

// The published command list has to be one the shell really resolves, otherwise
// the palette would advertise commands that cannot run. Sampling a few names is
// deliberate: bash's own `compgen -c` never returns under MSYS when stdio is
// piped, and a per-name lookup is the same evidence with a bounded cost.
const SAFE_COMMAND_NAME = /^[\w.+-]+$/;
const SAMPLE_PREFERENCE = ['git', 'python', 'ls', 'node', 'dir'];

function sampleCommands(published) {
  const safe = published.filter((name) => SAFE_COMMAND_NAME.test(name));
  const preferred = SAMPLE_PREFERENCE
    .map((name) => safe.find((candidate) => candidate.toLowerCase() === name))
    .filter((name) => name !== undefined);
  const rest = safe.filter((name) => !preferred.includes(name));
  return [...new Set([...preferred, ...rest])].slice(0, 3);
}

function resolvesName(profile, name) {
  switch (profile.family) {
    // A cmdlet or function has no Source, so the lookup asks whether the name
    // resolves at all rather than where it comes from.
    case 'powershell': return `if (Get-Command '${name}' -ErrorAction SilentlyContinue) { 'ok' }`;
    case 'cmd': return `where ${name}`;
    case 'bash':
    case 'posix':
    case 'wsl': return `command -v '${name}'`;
    // NuShell resolves through `which`, and its output is a table; the sample
    // check is skipped there rather than parsed unreliably.
    default: return '';
  }
}

/**
 * The verdicts that decide a shell's row, without a machine: what the probes
 * answered goes in, the reason comes out. They encode the guarantees this check
 * exists for — the marker, the shell's own commands reaching the list, and the
 * advertised names resolving in the shell.
 */
export function shellMarkerVerdict(marker) {
  const ok = Boolean(marker?.ok) && String(marker?.stdout ?? '').includes(MARKER);
  return { ok, reason: ok ? '' : (marker?.ok ? 'marker missing from output' : marker?.reason ?? 'the shell did not answer') };
}

export function shellSelfReportVerdict({ reportedNames, published, limit = TERMINAL_COMMAND_LIMITS.commands }) {
  // A shell that reports nothing (cmd, a POSIX shell without compgen) is not
  // asked; reportedNames is null for it.
  if (!reportedNames) return { reason: '', selfReported: 0, first: undefined };
  const names = reportedNames instanceof Set ? reportedNames : new Set(reportedNames);
  const shared = published.filter((name) => names.has(name));
  let reason = '';
  if (names.size && !shared.length) {
    reason = 'the list carries none of the commands the shell reports about itself';
  } else if (shared.length && shared.length < names.size && published.length < limit) {
    // While the list is under its cap nothing may be dropped: a command the shell
    // reports and the list does not carry is the cmdlet the user looks for and
    // does not find.
    reason = `only ${shared.length} of ${names.size} shell-reported commands reached the list`;
  }
  return { reason, selfReported: shared.length, first: shared[0] };
}

export function shellSampleVerdict(samples, resolved) {
  if (!samples.length || resolved.length) return { reason: '' };
  return { reason: `the shell resolves none of its advertised commands (${samples.join(', ')})` };
}

export async function verifyShells({
  platform = process.platform, timeoutMs = DEFAULT_TIMEOUT_MS, profileId, checkPath = true, profiles: injected,
} = {}) {
  // A check that can only be tested on the machine it describes is hard to trust:
  // an injected profile lets the tests show what a broken shell produces.
  const report = injected ? { profiles: injected, missing: [] } : await discoverTerminalProfileReport({ platform });
  const discovered = report.profiles;
  const profiles = profileId ? discovered.filter((profile) => profile.id === profileId) : discovered;
  if (!profiles.length) throw new Error(profileId ? `No terminal profile matched "${profileId}".` : 'No shell profile was discovered.');
  const commandProbe = checkPath ? createCommandProbe(platform) : undefined;
  const results = [];
  try {
    for (const profile of profiles) {
      // A WSL session may have to start its distro before it answers anything, and
      // a loaded machine turns that into tens of seconds: the budget has to cover
      // a cold distro, not an idle one.
      const profileTimeoutMs = profile.family === 'wsl' ? Math.max(timeoutMs, WSL_PROFILE_TIMEOUT_MS) : timeoutMs;
      const environment = sessionEnvironment(profile, process.env, platform);
      const marker = await probe(profile, profile.family === 'powershell' ? `Write-Output '${MARKER}'` : `echo ${MARKER}`,
        { timeoutMs: profileTimeoutMs, environment });
      const base = {
        id: profile.id, label: profile.label, family: profile.family, executable: profile.executable,
        durationMs: marker.durationMs, pathPrepend: profile.pathPrepend ?? [],
      };
      const markerVerdict = shellMarkerVerdict(marker);
      if (!markerVerdict.ok) {
        results.push({ ...base, status: 'failed', reason: markerVerdict.reason, pathProbe: 'not-checked' });
        continue;
      }
      let pathProbe = 'not-applicable';
      let reason = '';
      // A WSL session runs inside the distro, whose PATH is its own; the Windows
      // launcher directory cannot be observed from there.
      if (commandProbe && profile.family !== 'wsl') {
        const enriched = sessionEnvironment(
          { ...profile, pathPrepend: [commandProbe.directory, ...(profile.pathPrepend ?? [])] }, process.env, platform,
        );
        const run = await probe(profile, commandProbe.command, { timeoutMs, environment: enriched });
        if (run.ok && run.stdout.includes(PATH_MARKER)) pathProbe = 'reachable';
        else {
          pathProbe = 'unreachable';
          reason = run.ok ? 'the probe command did not print its marker' : `the probe command could not run (${run.reason})`;
        }
      }
      // The list has to carry what the shell says about itself, not just the files on
      // its PATH: a cmdlet or a builtin is exactly what makes the palette useful in
      // a PowerShell or bash session. A shell that reports nothing (cmd, a POSIX
      // shell without compgen) skips the check instead of failing it.
      const published = await discoverTerminalCommands(profile, { platform });
      const report = shellReportCommand(profile.family);
      let answerNames;
      if (report) {
        const answer = await probe(profile, report, { timeoutMs: profileTimeoutMs, environment });
        answerNames = new Set(answer.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
      }
      const selfReport = shellSelfReportVerdict({ reportedNames: report ? answerNames : null, published });
      const selfReported = selfReport.selfReported;
      reason = reason || selfReport.reason;
      // Sample one of the shell's own commands as well, so the check covers both
      // what the PATH holds and what the shell knows.
      const extraSample = selfReport.first ? [selfReport.first] : [];
      const samples = published.length ? [...new Set([...extraSample, ...sampleCommands(published)])].slice(0, 3) : [];
      const resolved = [];
      for (const name of samples) {
        const resolve = resolvesName(profile, name);
        if (!resolve) break;
        const lookup = await probe(profile, resolve, { timeoutMs: profileTimeoutMs, environment });
        if (lookup.ok && lookup.stdout.trim()) resolved.push(name);
      }
      reason = reason || shellSampleVerdict(samples, resolved).reason;
      results.push({
        ...base, status: reason ? 'failed' : 'ok', reason, pathProbe,
        commands: published.length, commandsReported: selfReported,
        // A list at its bound is not a failure —the bound is deliberate —but it
        // is the one case where commands may have been left out.
        atBound: published.length >= TERMINAL_COMMAND_LIMITS.commands,
        samples, resolved,
      });
    }
  } finally {
    commandProbe?.dispose();
  }
  // The shells that were looked for and not offered travel with the results: a
  // profile that disappeared under load must not look like coverage.
  return { results, missing: profileId ? [] : report.missing };
}

function render({ results, missing }) {
  const width = Math.max(...results.map((result) => result.label.length), 5);
  for (const result of results) {
    const commands = result.commands
      ? `${result.commands} commands${result.atBound ? ' (at the list bound)' : ''} (${result.resolved.length}/${result.samples.length} sampled resolve${result.commandsReported ? `, ${result.commandsReported} of them the shell's own` : ''})`
      : 'no command list';
    const detail = result.status === 'ok'
      ? `marker ok; path ${result.pathProbe}; ${commands}`
      : result.reason;
    process.stdout.write(`${result.status === 'ok' ? 'ok     ' : 'FAILED '} ${result.label.padEnd(width)}  ${String(result.family).padEnd(11)} ${String(result.durationMs).padStart(6)} ms  ${detail}\n`);
  }
  const failed = results.filter((result) => result.status !== 'ok');
  process.stdout.write(`\n${results.length - failed.length}/${results.length} shells verified\n`);
  if (missing?.length) {
    process.stdout.write(`not offered: ${missing.map((entry) => `${entry.label} (${entry.reason})`).join('; ')}\n`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const profileId = args.find((argument) => argument.startsWith('--profile='))?.slice('--profile='.length);
  const timeoutMs = Number(args.find((argument) => argument.startsWith('--timeout-ms='))?.slice('--timeout-ms='.length)) || DEFAULT_TIMEOUT_MS;
  const report = await verifyShells({ timeoutMs, profileId, checkPath: !args.includes('--no-path-probe') });
  if (json) process.stdout.write(`${JSON.stringify({ marker: MARKER, pathMarker: PATH_MARKER, ...report }, null, 2)}\n`);
  else render(report);
  process.exitCode = report.results.some((result) => result.status !== 'ok') ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`verify-shells: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}