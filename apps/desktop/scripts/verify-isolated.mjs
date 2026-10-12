#!/usr/bin/env node
// Verify the isolated backend end to end on this machine. Detection answers
// whether a WSL2 distro can create the namespaces and which languages it has the
// binaries for; every available language then runs a real fixture, and three
// extra payloads ask the sandbox what it does from the inside: a TCP connection
// has to be refused, /proc has to show the namespace's own table, the host
// filesystem has to be out of reach, and a cancelled run has to leave nothing
// running in the distro.
//
//   node scripts/verify-isolated.mjs [--json] [--timeout-ms=60000]
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { ISOLATED_LANGUAGES, isolatedLanguageIds, isolatedRunPlan } from '../src/isolated-languages.mjs';
import { createIsolatedRunner, sandboxDirectory } from '../src/isolated-runner.mjs';
import { resolveInsideRoot } from '../src/workspace.mjs';

const execute = promisify(execFile);

export const MARKER = 'SANDKASTEN_ISOLATED_OK';
export const NETWORK_BLOCKED = 'NETWORK_BLOCKED';
const DEFAULT_TIMEOUT_MS = 60_000;

export const LANGUAGE_LABELS = {
  python: 'Python', javascript: 'JavaScript', c: 'C', cpp: 'C++', java: 'Java', bash: 'Bash', perl: 'Perl',
};

export const LANGUAGE_FIXTURES = {
  python: { file: 'main.py', source: `print("${MARKER}:python")\n` },
  javascript: { file: 'main.js', source: `console.log("${MARKER}:javascript");\n` },
  c: { file: 'main.c', source: `#include <stdio.h>\n\nint main(void) { printf("${MARKER}:c\\n"); return 0; }\n` },
  cpp: { file: 'main.cpp', source: `#include <iostream>\n\nint main() { std::cout << "${MARKER}:cpp" << std::endl; return 0; }\n` },
  java: {
    file: 'Main.java',
    source: `public class Main {\n  public static void main(String[] args) { System.out.println("${MARKER}:java"); }\n}\n`,
  },
  bash: { file: 'main.sh', source: `echo "${MARKER}:bash"\n` },
  perl: { file: 'main.pl', source: `print "${MARKER}:perl\\n";\n` },
};

const ISOLATION_FIXTURES = [
  {
    id: 'network',
    label: 'Network namespace',
    file: 'net.py',
    source: [
      'import socket',
      'sock = socket.socket()',
      'sock.settimeout(3)',
      'try:',
      "    sock.connect(('1.1.1.1', 53))",
      "    print('NETWORK_OPEN')",
      'except Exception:',
      `    print('${NETWORK_BLOCKED}')`,
      '',
    ].join('\n'),
    expect: NETWORK_BLOCKED,
  },
  {
    id: 'processes',
    label: 'PID namespace',
    file: 'pid.py',
    source: [
      "print('PID1=' + open('/proc/1/comm').read().strip())",
      "import os",
      "print('PROCS=' + str(len(os.listdir('/proc'))))",
      '',
    ].join('\n'),
    expect: 'PID1=',
  },
  {
    // The namespaces cover user, network and PID; the filesystem is a separate
    // question, so the payload answers it: a WSL distro exposes the Windows
    // drives under /mnt, which is where the host files live.
    id: 'host-files',
    label: 'Host filesystem',
    file: 'files.py',
    source: [
      "import os",
      "drives = sorted(os.listdir('/mnt')) if os.path.isdir('/mnt') else []",
      "print('HOSTFILES=' + ('visible' if drives else 'hidden'))",
      "print('DRIVES=' + ','.join(drives))",
      '',
    ].join('\n'),
    expect: 'HOSTFILES=',
  },
];

function brief(text, limit = 300) {
  const trimmed = String(text ?? '').trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed;
}

function parseProcessFacts(stdout) {
  return {
    pid1: /PID1=(\S+)/.exec(stdout)?.[1] ?? '',
    processes: Number(/PROCS=(\d+)/.exec(stdout)?.[1] ?? NaN),
    hostFiles: /HOSTFILES=(\w+)/.exec(stdout)?.[1] ?? '',
  };
}

/** Counts the processes of one sandbox from inside the distro. */
async function sandboxCounter(distro, jobId) {
  const directory = sandboxDirectory(jobId);
  // The pattern is written with a character class so the counting command, whose
  // own command line carries the bracketed form, cannot match itself.
  const pattern = `[${directory.slice(0, 1)}]${directory.slice(1)}/`;
  return async () => {
    try {
      const { stdout } = await execute('wsl.exe', ['-d', distro, '--exec', 'sh', '-c', `pgrep -f '${pattern}' | wc -l`], {
        encoding: 'utf8', timeout: 30_000, windowsHide: true,
      });
      return Number(stdout.trim()) || 0;
    } catch {
      return 0;
    }
  };
}

/**
 * A cancellation has to reach the payload, not just the WSL client: the fixture
 * starts a payload that sleeps, waits until it is really running in the distro,
 * cancels the run, and then counts what is left.
 */
async function runCancellationProbe(runner, root, distro, timeoutMs) {
  const file = 'cancel.py';
  await writeFile(path.join(root, file), 'import time\nprint("CANCEL_READY", flush=True)\ntime.sleep(120)\n', 'utf8');
  const jobId = 'verify-cancellation';
  const survivors = await sandboxCounter(distro, jobId);

  const started = Date.now();
  const pending = runner.run({
    jobId, path: file, absolutePath: resolveInsideRoot(root, file),
    language: 'python', command: 'python3', args: ['{file}'], timeoutMs,
  }, { root });

  let running = 0;
  for (let attempt = 0; attempt < 40 && running === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    running = await survivors();
  }
  await runner.stop(jobId);
  const result = await pending;
  // The kill travels on its own; give it a moment before counting the survivors.
  await new Promise((resolve) => setTimeout(resolve, 500));
  return { result, durationMs: Date.now() - started, running, left: await survivors() };
}

/**
 * A payload that prints past the cap has to be stopped, not merely truncated:
 * otherwise it burns the machine until the time limit and is reported as a
 * timeout, while its output was already discarded.
 */
async function runOutputLimitProbe(runner, root, distro, timeoutMs) {
  const file = 'flood.py';
  await writeFile(path.join(root, file), 'while True:\n    print("x" * 4096)\n', 'utf8');
  const jobId = 'verify-output-limit';
  const survivors = await sandboxCounter(distro, jobId);
  const maxOutputBytes = 16 * 1024;

  const started = Date.now();
  const result = await runner.run({
    jobId, path: file, absolutePath: resolveInsideRoot(root, file),
    language: 'python', command: 'python3', args: ['{file}'], timeoutMs, maxOutputBytes,
  }, { root });
  await new Promise((resolve) => setTimeout(resolve, 500));
  return { result, durationMs: Date.now() - started, kept: result.stdout.length, left: await survivors(), maxOutputBytes };
}

/**
 * The verdicts the check reaches, as pure functions: what the payload reported is
 * the input, what the row says is the output. They are the part that has to fail
 * when the sandbox stops doing what it promises, so they are testable without a
 * distro.
 */
export function languageVerdict({ status, stdout, errorMessage }, expect) {
  const ok = status === 'JOB_STATUS_SUCCEEDED' && String(stdout ?? '').includes(expect);
  return { ok, reason: ok ? '' : errorMessage || `marker ${expect} missing (${status})` };
}

export function isolationFixtureVerdict(check, result, facts) {
  if (result.status !== 'JOB_STATUS_SUCCEEDED' || !String(result.stdout ?? '').includes(check.expect)) {
    return { ok: false, reason: result.errorMessage || `marker ${check.expect} missing (${result.status})`, note: '' };
  }
  if (check.id === 'processes' && (facts.pid1 === 'init' || !(facts.processes > 0))) {
    return { ok: false, reason: `the payload sees the host process table (PID 1 is ${facts.pid1 || 'unknown'})`, note: '' };
  }
  if (check.id === 'host-files') {
    // A run copies its payload into a private directory and masks the drives a
    // distro mounts, so a payload that can still read them means the sandbox is
    // not doing what the backend says it does.
    return facts.hostFiles === 'visible'
      ? { ok: false, reason: 'the payload can still read the host filesystem (the distro refused the mask)', note: '' }
      : { ok: true, reason: '', note: 'the host filesystem is out of reach' };
  }
  return { ok: true, reason: '', note: '' };
}

export function cancellationVerdict({ running, status, left }) {
  if (!running) return { ok: false, reason: 'the payload never started, so nothing was cancelled', note: '' };
  if (status !== 'JOB_STATUS_CANCELED') return { ok: false, reason: `a cancelled run reported ${status}`, note: '' };
  if (left !== 0) return { ok: false, reason: `${left} process(es) kept running after the cancellation`, note: '' };
  return { ok: true, reason: '', note: `stopped ${running} process(es) and left nothing running` };
}

export function outputLimitVerdict({ status, left, kept, durationMs }) {
  if (status !== 'JOB_STATUS_OUTPUT_LIMIT_EXCEEDED') {
    return { ok: false, reason: `a flooding payload reported ${status} after ${durationMs} ms`, note: '' };
  }
  if (left !== 0) return { ok: false, reason: `${left} process(es) kept running after the output limit`, note: '' };
  return { ok: true, reason: '', note: `stopped at ${kept} characters and left nothing running` };
}

export async function verifyIsolated({ timeoutMs = DEFAULT_TIMEOUT_MS, workRoot, distros } = {}) {
  const runner = createIsolatedRunner(distros ? { distros } : {});
  const detection = await runner.detect({ refresh: true });
  if (!detection.available) {
    return { detection, results: [] };
  }
  const root = workRoot ?? await mkdtemp(path.join(os.tmpdir(), 'sandkasten-isolated-verify-'));
  const ownsRoot = !workRoot;
  const results = [];

  async function runFixture(check, language) {
    const plan = isolatedRunPlan(language);
    await writeFile(path.join(root, check.file), check.source, 'utf8');
    const started = Date.now();
    const result = await runner.run({
      jobId: `verify-${check.id}`,
      path: check.file,
      absolutePath: resolveInsideRoot(root, check.file),
      language: plan.language,
      command: plan.command,
      args: plan.args,
      timeoutMs,
    }, { root });
    return { result, durationMs: Date.now() - started };
  }

  try {
    for (const language of isolatedLanguageIds()) {
      const fixture = LANGUAGE_FIXTURES[language];
      const label = LANGUAGE_LABELS[language] ?? language;
      if (detection.languages[language] !== true) {
        results.push({
          id: language, label, kind: 'language', status: 'unavailable',
          reason: `the distro has no ${ISOLATED_LANGUAGES[language].tools.join(' or ')}`,
        });
        continue;
      }
      const { result, durationMs } = await runFixture({ ...fixture, id: language }, language);
      const expect = `${MARKER}:${language}`;
      const ok = result.status === 'JOB_STATUS_SUCCEEDED' && result.stdout.includes(expect);
      results.push({
        id: language, label: label.padEnd(11).trim(), kind: 'language',
        status: ok ? 'ok' : 'failed',
        jobStatus: result.status, exitCode: result.exitCode, durationMs,
        stdout: brief(result.stdout), stderr: brief(result.stderr),
        reason: ok ? '' : result.errorMessage || `marker ${expect} missing (${result.status})`,
      });
    }

    for (const check of ISOLATION_FIXTURES) {
      if (detection.languages.python !== true) {
        results.push({ id: check.id, label: check.label, kind: 'isolation', status: 'unavailable', reason: 'the probe payload needs python3' });
        continue;
      }
      const { result, durationMs } = await runFixture(check, 'python');
      const facts = parseProcessFacts(result.stdout);
      const verdict = isolationFixtureVerdict(check, result, facts);
      results.push({
        id: check.id, label: check.label, kind: 'isolation', status: verdict.ok ? 'ok' : 'failed',
        jobStatus: result.status, exitCode: result.exitCode, durationMs, note: verdict.note,
        stdout: brief(result.stdout), stderr: brief(result.stderr),
        pid1: facts.pid1, processes: facts.processes, reason: verdict.reason,
      });
    }

    if (detection.languages.python === true) {
      const cancellation = await runCancellationProbe(runner, root, detection.distro, timeoutMs);
      const cancelled = cancellationVerdict({
        running: cancellation.running, status: cancellation.result.status, left: cancellation.left,
      });
      results.push({
        id: 'cancellation', label: 'Cancellation', kind: 'isolation',
        status: cancelled.ok ? 'ok' : 'failed', jobStatus: cancellation.result.status,
        note: cancelled.note, reason: cancelled.reason,
        durationMs: cancellation.durationMs, stdout: brief(cancellation.result.stdout), stderr: brief(cancellation.result.stderr),
      });

      const outputLimit = await runOutputLimitProbe(runner, root, detection.distro, timeoutMs);
      const limited = outputLimitVerdict({
        status: outputLimit.result.status, left: outputLimit.left,
        kept: outputLimit.kept, durationMs: outputLimit.durationMs,
      });
      results.push({
        id: 'output-limit', label: 'Output limit', kind: 'isolation',
        status: limited.ok ? 'ok' : 'failed', jobStatus: outputLimit.result.status,
        note: limited.note, reason: limited.reason, durationMs: outputLimit.durationMs,
        // The payload's output is deliberately repetitive; the note says what
        // matters about it.
        stdout: '', stderr: brief(outputLimit.result.stderr),
      });
    }
  } finally {
    if (ownsRoot) await rm(root, { recursive: true, force: true });
  }
  return { detection, results };
}

function render({ detection, results }) {
  if (!detection.available) {
    process.stdout.write('unavailable  no WSL2 distro can create the isolation namespaces\n');
    return;
  }
  const available = Object.values(detection.languages).filter(Boolean).length;
  const width = Math.max(...results.map((result) => result.label.length), 5);
  for (const result of results) {
    const detail = result.status === 'ok'
      ? [brief(result.stdout), result.pid1 ? `pid1=${result.pid1}, ${result.processes} processes` : '', result.note].filter(Boolean).join('; ')
      : result.reason;
    process.stdout.write(`${result.status.padEnd(11)} ${result.label.padEnd(width)} ${String(result.durationMs ?? 0).padStart(6)} ms  ${detail}\n`);
  }
  const failed = results.filter((result) => result.status === 'failed');
  const languages = results.filter((result) => result.kind === 'language');
  const ran = languages.filter((result) => result.status === 'ok').length;
  const skipped = languages.filter((result) => result.status === 'unavailable').length;
  process.stdout.write(`\n${ran} isolated languages ran, ${skipped} unavailable, ${failed.length} failed in ${detection.distro} (${available}/${isolatedLanguageIds().length} languages have their binaries)\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const timeoutMs = Number(args.find((argument) => argument.startsWith('--timeout-ms='))?.slice('--timeout-ms='.length)) || DEFAULT_TIMEOUT_MS;
  const report = await verifyIsolated({ timeoutMs });
  if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else render(report);
  process.exitCode = report.results.some((result) => result.status === 'failed') ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`verify-isolated: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}