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

import { discoverTerminalProfiles } from '../src/terminal-profiles.mjs';
import { TERMINAL_COMMAND_LIMITS, discoverTerminalCommands, shellReportCommand } from '../src/terminal-commands.mjs';
import { sessionEnvironment } from '../src/terminal.mjs';

const MARKER = 'SANDKASTEN_SHELL_OK';
const PATH_MARKER = 'SANDKASTEN_PATH_OK';
// A WSL session may have to cold-start a distro before it can answer, so the
// verification budget is far larger than an interactive prompt would need.
const DEFAULT_TIMEOUT_MS = 30_000;

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

export async function verifyShells({ platform = process.platform, timeoutMs = DEFAULT_TIMEOUT_MS, profileId, checkPath = true } = {}) {
  const discovered = await discoverTerminalProfiles({ platform });
  const profiles = profileId ? discovered.filter((profile) => profile.id === profileId) : discovered;
  if (!profiles.length) throw new Error(profileId ? `No terminal profile matched "${profileId}".` : 'No shell profile was discovered.');
  const commandProbe = checkPath ? createCommandProbe(platform) : undefined;
  const results = [];
  try {
    for (const profile of profiles) {
      const environment = sessionEnvironment(profile, process.env, platform);
      const marker = await probe(profile, profile.family === 'powershell' ? `Write-Output '${MARKER}'` : `echo ${MARKER}`,
        { timeoutMs, environment });
      const base = {
        id: profile.id, label: profile.label, family: profile.family, executable: profile.executable,
        durationMs: marker.durationMs, pathPrepend: profile.pathPrepend ?? [],
      };
      if (!marker.ok || !marker.stdout.includes(MARKER)) {
        results.push({ ...base, status: 'failed', reason: marker.ok ? 'marker missing from output' : marker.reason, pathProbe: 'not-checked' });
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
      let selfReported = 0;
      let extraSample = [];
      if (report) {
        const answer = await probe(profile, report, { timeoutMs, environment });
        const names = new Set(answer.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
        const shared = published.filter((name) => names.has(name));
        selfReported = shared.length;
        if (names.size && !shared.length) {
          reason = reason || 'the list carries none of the commands the shell reports about itself';
        }
        // While the list is under its cap nothing may be dropped: a command the
        // shell reports and the list does not carry is exactly the cmdlet the user
        // will look for and not find.
        if (shared.length && shared.length < names.size && published.length < TERMINAL_COMMAND_LIMITS.commands) {
          reason = reason || `only ${shared.length} of ${names.size} shell-reported commands reached the list`;
        }
        // Sample one of the shell's own commands as well, so the check covers both
        // what the PATH holds and what the shell knows.
        if (shared.length) extraSample = [shared[0]];
      }
      const samples = published.length ? [...new Set([...extraSample, ...sampleCommands(published)])].slice(0, 3) : [];
      const resolved = [];
      for (const name of samples) {
        const resolve = resolvesName(profile, name);
        if (!resolve) break;
        const lookup = await probe(profile, resolve, { timeoutMs, environment });
        if (lookup.ok && lookup.stdout.trim()) resolved.push(name);
      }
      if (samples.length && !resolved.length) {
        reason = reason || `the shell resolves none of its advertised commands (${samples.join(', ')})`;
      }
      results.push({
        ...base, status: reason ? 'failed' : 'ok', reason, pathProbe,
        commands: published.length, commandsReported: selfReported, samples, resolved,
      });
    }
  } finally {
    commandProbe?.dispose();
  }
  return results;
}

function render(results) {
  const width = Math.max(...results.map((result) => result.label.length), 5);
  for (const result of results) {
    const commands = result.commands
      ? `${result.commands} commands (${result.resolved.length}/${result.samples.length} sampled resolve${result.commandsReported ? `, ${result.commandsReported} of them the shell's own` : ''})`
      : 'no command list';
    const detail = result.status === 'ok'
      ? `marker ok; path ${result.pathProbe}; ${commands}`
      : result.reason;
    process.stdout.write(`${result.status === 'ok' ? 'ok     ' : 'FAILED '} ${result.label.padEnd(width)}  ${String(result.family).padEnd(11)} ${String(result.durationMs).padStart(6)} ms  ${detail}\n`);
  }
  const failed = results.filter((result) => result.status !== 'ok');
  process.stdout.write(`\n${results.length - failed.length}/${results.length} shells verified\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const profileId = args.find((argument) => argument.startsWith('--profile='))?.slice('--profile='.length);
  const timeoutMs = Number(args.find((argument) => argument.startsWith('--timeout-ms='))?.slice('--timeout-ms='.length)) || DEFAULT_TIMEOUT_MS;
  const results = await verifyShells({ timeoutMs, profileId, checkPath: !args.includes('--no-path-probe') });
  if (json) process.stdout.write(`${JSON.stringify({ marker: MARKER, pathMarker: PATH_MARKER, results }, null, 2)}\n`);
  else render(results);
  process.exitCode = results.some((result) => result.status !== 'ok') ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`verify-shells: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}