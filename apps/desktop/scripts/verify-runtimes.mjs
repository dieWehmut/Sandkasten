#!/usr/bin/env node
// Verify local multi-language execution: detect the toolchains installed on this
// machine, run a hello-world fixture for every available runtime through the
// real local runner, and require that fixture's marker on stdout. Runtimes whose
// toolchain is absent are reported as unavailable instead of failing the run.
//
//   node scripts/verify-runtimes.mjs [--json] [--language=go] [--timeout-ms=60000]
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createLocalRunner, LOCAL_RUNTIMES } from '../src/local-runner.mjs';

export const MARKER = 'SANDKASTEN_RUNTIME_OK';
const DEFAULT_TIMEOUT_MS = 60_000;

export const RUNTIME_FIXTURES = {
  python: { file: 'main.py', source: `print("${MARKER}:python")\n` },
  javascript: { file: 'main.mjs', source: `console.log("${MARKER}:javascript");\n` },
  typescript: { file: 'main.ts', source: `const marker: string = "${MARKER}:typescript";\nconsole.log(marker);\n` },
  go: { file: 'main.go', source: `package main\n\nimport "fmt"\n\nfunc main() { fmt.Println("${MARKER}:go") }\n` },
  rust: { file: 'main.rs', source: `fn main() { println!("${MARKER}:rust"); }\n` },
  c: { file: 'main.c', source: `#include <stdio.h>\n\nint main(void) { printf("${MARKER}:c\\n"); return 0; }\n` },
  cpp: { file: 'main.cpp', source: `#include <iostream>\n\nint main() { std::cout << "${MARKER}:cpp" << std::endl; return 0; }\n` },
  java: {
    file: 'Main.java',
    source: `public class Main {\n  public static void main(String[] args) { System.out.println("${MARKER}:java"); }\n}\n`,
  },
  ruby: { file: 'main.rb', source: `puts "${MARKER}:ruby"\n` },
  php: { file: 'main.php', source: `<?php echo "${MARKER}:php\\n";\n` },
  bash: { file: 'main.sh', source: `echo "${MARKER}:bash"\n` },
  lua: { file: 'main.lua', source: `print("${MARKER}:lua")\n` },
  perl: { file: 'main.pl', source: `print "${MARKER}:perl\\n";\n` },
  powershell: { file: 'main.ps1', source: `Write-Output "${MARKER}:powershell"\n` },
};

function brief(text, limit = 400) {
  const trimmed = String(text ?? '').trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed;
}

// One table cell, not a compiler transcript: the JSON keeps the full output.
function compact(text, limit = 180) {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim();
  return line.length > limit ? `${line.slice(0, limit)}…` : line;
}

export async function verifyRuntimes({ languages, timeoutMs = DEFAULT_TIMEOUT_MS, workRoot } = {}) {
  const root = workRoot ?? await mkdtemp(path.join(os.tmpdir(), 'sandkasten-runtime-verify-'));
  const ownsRoot = !workRoot;
  const selected = languages ? new Set(languages) : undefined;
  const detection = await createLocalRunner().detect({ refresh: true });
  const available = new Map(detection.map((entry) => [entry.language, entry.available]));
  const results = [];
  try {
    for (const [language, runtime] of Object.entries(LOCAL_RUNTIMES)) {
      if (selected && !selected.has(language)) continue;
      const fixture = RUNTIME_FIXTURES[language];
      if (!fixture) {
        results.push({ language, label: runtime.label, status: 'unsupported', reason: 'no verification fixture' });
        continue;
      }
      if (!available.get(language)) {
        results.push({
          language, label: runtime.label, status: 'unavailable',
          reason: `${runtime.compile?.command ?? runtime.command} was not found`,
        });
        continue;
      }
      await writeFile(path.join(root, fixture.file), fixture.source, 'utf8');
      // Every run gets its own job id: the runner builds into a directory named after
// it, and a locked build output left by an earlier verification must never make
// a later, otherwise healthy run fail.
      const result = await createLocalRunner().run(
        { jobId: `verify-${language}-${randomUUID().slice(0, 8)}`, path: fixture.file, language, timeoutMs },
        { root },
      );
      const expected = `${MARKER}:${language}`;
      const ok = result.status === 'JOB_STATUS_SUCCEEDED' && result.stdout.includes(expected);
      results.push({
        language, label: runtime.label, status: ok ? 'ok' : 'failed',
        jobStatus: result.status, exitCode: result.exitCode, durationMs: result.durationMs,
        stdout: brief(result.stdout), stderr: brief(result.stderr || result.compileStderr),
        hint: result.hint ?? '',
        reason: ok ? '' : result.errorMessage || `marker ${expected} missing (${result.status})`,
      });
    }
  } finally {
    if (ownsRoot) await rm(root, { recursive: true, force: true });
  }
  return results;
}

function render(results) {
  const width = Math.max(...results.map((result) => result.label.length), 5);
  for (const result of results) {
    // A failure is only actionable with the toolchain's own words: the reason
    // alone ("Compilation failed") hides which step refused and why.
    const detail = result.status === 'ok'
      ? brief(result.stdout)
      : result.status === 'unavailable'
        ? result.reason
        : [result.reason, compact(result.stderr), result.hint ? `hint: ${compact(result.hint, 200)}` : ''].filter(Boolean).join(' — ');
    process.stdout.write(`${result.status.padEnd(11)} ${result.label.padEnd(width)} ${String(result.durationMs ?? 0).padStart(6)} ms  ${detail}\n`);
  }
  const ran = results.filter((result) => result.status === 'ok').length;
  const unavailable = results.filter((result) => result.status === 'unavailable').length;
  const failed = results.filter((result) => result.status !== 'ok' && result.status !== 'unavailable');
  process.stdout.write(`\n${ran} runtimes verified, ${unavailable} unavailable, ${failed.length} failed\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const language = args.find((argument) => argument.startsWith('--language='))?.slice('--language='.length);
  const timeoutMs = Number(args.find((argument) => argument.startsWith('--timeout-ms='))?.slice('--timeout-ms='.length)) || DEFAULT_TIMEOUT_MS;
  const results = await verifyRuntimes({ languages: language ? [language] : undefined, timeoutMs });
  if (json) process.stdout.write(`${JSON.stringify({ marker: MARKER, results }, null, 2)}\n`);
  else render(results);
  process.exitCode = results.some((result) => result.status === 'failed' || result.status === 'unsupported') ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`verify-runtimes: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}