#!/usr/bin/env node
// Verify the isolated backend end to end on this machine. Detection answers
// whether a WSL2 distro can create the namespaces; the checks then run real
// fixtures through it and ask the *payload* what the sandbox looks like from
// inside: it has to run the program, fail to reach the network, and see a
// process table of its own.
//
//   node scripts/verify-isolated.mjs [--json] [--timeout-ms=60000]
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createIsolatedRunner } from '../src/isolated-runner.mjs';
import { resolveInsideRoot } from '../src/workspace.mjs';

export const MARKER = 'SANDKASTEN_ISOLATED_OK';
export const NETWORK_BLOCKED = 'NETWORK_BLOCKED';
const DEFAULT_TIMEOUT_MS = 60_000;

export const ISOLATED_CHECKS = [
  {
    id: 'python',
    label: 'Python',
    file: 'main.py',
    source: `print("${MARKER}:python")\n`,
    command: 'python3',
    language: 'python',
    expect: `${MARKER}:python`,
  },
  {
    id: 'bash',
    label: 'Bash',
    file: 'main.sh',
    source: `echo "${MARKER}:bash"\n`,
    command: 'bash',
    language: 'bash',
    expect: `${MARKER}:bash`,
  },
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
    command: 'python3',
    language: 'python',
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
    command: 'python3',
    language: 'python',
    expect: 'PID1=',
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
  };
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
  try {
    for (const check of ISOLATED_CHECKS) {
      await writeFile(path.join(root, check.file), check.source, 'utf8');
      const result = await runner.run({
        jobId: `verify-${check.id}`,
        path: check.file,
        absolutePath: resolveInsideRoot(root, check.file),
        language: check.language,
        command: check.command,
        args: ['{file}'],
        timeoutMs,
      }, { root });
      const facts = parseProcessFacts(result.stdout);
      let reason = '';
      if (result.status !== 'JOB_STATUS_SUCCEEDED' || !result.stdout.includes(check.expect)) {
        reason = result.errorMessage || `marker ${check.expect} missing (${result.status})`;
      } else if (check.id === 'processes' && (facts.pid1 === 'init' || !(facts.processes > 0))) {
        reason = `the payload sees the host process table (PID 1 is ${facts.pid1 || 'unknown'})`;
      }
      results.push({
        id: check.id,
        label: check.label,
        status: reason ? 'failed' : 'ok',
        jobStatus: result.status,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        stdout: brief(result.stdout),
        stderr: brief(result.stderr),
        pid1: facts.pid1,
        processes: facts.processes,
        reason,
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
  const width = Math.max(...results.map((result) => result.label.length), 5);
  for (const result of results) {
    const detail = result.status === 'ok'
      ? [brief(result.stdout), result.pid1 ? `pid1=${result.pid1}, ${result.processes} processes` : ''].filter(Boolean).join('; ')
      : result.reason;
    process.stdout.write(`${result.status.padEnd(6)} ${result.label.padEnd(width)} ${String(result.durationMs ?? 0).padStart(6)} ms  ${detail}\n`);
  }
  const failed = results.filter((result) => result.status !== 'ok');
  process.stdout.write(`\n${results.length - failed.length}/${results.length} isolated checks passed in ${detection.distro}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const timeoutMs = Number(args.find((argument) => argument.startsWith('--timeout-ms='))?.slice('--timeout-ms='.length)) || DEFAULT_TIMEOUT_MS;
  const report = await verifyIsolated({ timeoutMs });
  if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else render(report);
  process.exitCode = report.results.some((result) => result.status !== 'ok') ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`verify-isolated: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}