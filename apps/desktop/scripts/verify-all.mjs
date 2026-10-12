#!/usr/bin/env node
// One entry point for the machine checks: the installed shells, the local
// runtimes and the isolated backend. Each check runs in its own process and
// reports its own JSON, so this script only aggregates. A backend that is
// simply absent stays "unavailable"; anything installed but broken fails.
//
//   node scripts/verify-all.mjs [--json]
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const VERIFY_CHECKS = [
  { id: 'shells', label: 'Terminal shells', script: 'verify-shells.mjs' },
  // Every available runtime proves both halves: that its code runs, and that a
  // failing program comes back as a failure with its own exit code and stderr.
  { id: 'runtimes', label: 'Local runtimes', script: 'verify-runtimes.mjs', args: ['--failures'] },
  { id: 'isolated', label: 'Isolated backend', script: 'verify-isolated.mjs' },
];

function runScript(script, args) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [path.join(here, script), '--json', ...args], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    const finish = (code) => resolve({ code, stdout, stderr, durationMs: Date.now() - started });
    child.on('error', () => finish(-1));
    child.on('close', (code) => finish(code));
  });
}

/** Count one check's own report. `detection` marks the isolated backend. */
export function summarize(report) {
  if (report?.detection && report.detection.available === false) {
    return { ok: 0, unavailable: 1, failed: 0, unsupported: 0 };
  }
  const counts = { ok: 0, unavailable: 0, failed: 0, unsupported: 0 };
  for (const result of Array.isArray(report?.results) ? report.results : []) {
    if (result?.status === 'ok') counts.ok += 1;
    else if (result?.status === 'unavailable') counts.unavailable += 1;
    else if (result?.status === 'unsupported') counts.unsupported += 1;
    else counts.failed += 1;
  }
  return counts;
}

export async function verifyAll({ args = [] } = {}) {
  const checks = [];
  for (const check of VERIFY_CHECKS) {
    const outcome = await runScript(check.script, [...(check.args ?? []), ...args]);
    let report;
    try {
      report = JSON.parse(outcome.stdout.slice(outcome.stdout.indexOf('{')));
    } catch {
      report = undefined;
    }
    const counts = summarize(report);
    const broken = counts.failed + counts.unsupported;
    checks.push({
      ...check,
      durationMs: outcome.durationMs,
      counts,
      status: report === undefined ? 'failed' : broken ? 'failed' : 'ok',
      reason: report === undefined ? (outcome.stderr.trim() || 'no JSON report') : '',
    });
  }
  return checks;
}

function render(checks) {
  const width = Math.max(...checks.map((check) => check.label.length), 5);
  for (const check of checks) {
    const counts = `${check.counts.ok} ok, ${check.counts.unavailable} unavailable, ${check.counts.failed + check.counts.unsupported} failed`;
    const detail = check.status === 'ok' ? counts : `${counts}${check.reason ? ` — ${check.reason}` : ''}`;
    process.stdout.write(`${check.status === 'ok' ? 'ok     ' : 'FAILED '} ${check.label.padEnd(width)} ${String(check.durationMs).padStart(6)} ms  ${detail}\n`);
  }
  const failed = checks.filter((check) => check.status !== 'ok');
  process.stdout.write(`\n${checks.length - failed.length}/${checks.length} machine checks passed\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const forwarded = args.filter((argument) => argument.startsWith('--timeout-ms='));
  const checks = await verifyAll({ args: forwarded });
  if (json) process.stdout.write(`${JSON.stringify({ checks }, null, 2)}\n`);
  else render(checks);
  process.exitCode = checks.some((check) => check.status !== 'ok') ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`verify-all: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}