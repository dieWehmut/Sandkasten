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
// The other half of running code: a program that fails has to fail *visibly* —
// the exit code and its stderr reach the user, for every runtime.
export const FAILURE_MARKER = 'SANDKASTEN_RUNTIME_FAILED';
export const FAILURE_EXIT_CODE = 3;
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

export const RUNTIME_FAILURE_FIXTURES = {
  python: { file: 'fail.py', source: `import sys\nprint("${FAILURE_MARKER}:python", file=sys.stderr)\nsys.exit(${FAILURE_EXIT_CODE})\n` },
  javascript: { file: 'fail.mjs', source: `console.error("${FAILURE_MARKER}:javascript");\nprocess.exit(${FAILURE_EXIT_CODE});\n` },
  typescript: { file: 'fail.ts', source: `const code: number = ${FAILURE_EXIT_CODE};\nconsole.error("${FAILURE_MARKER}:typescript");\nprocess.exit(code);\n` },
  go: { file: 'fail.go', source: `package main\n\nimport (\n\t"fmt"\n\t"os"\n)\n\nfunc main() {\n\tfmt.Fprintln(os.Stderr, "${FAILURE_MARKER}:go")\n\tos.Exit(${FAILURE_EXIT_CODE})\n}\n` },
  rust: { file: 'fail.rs', source: `fn main() {\n    eprintln!("${FAILURE_MARKER}:rust");\n    std::process::exit(${FAILURE_EXIT_CODE});\n}\n` },
  c: { file: 'fail.c', source: `#include <stdio.h>\n\nint main(void) {\n  fprintf(stderr, "${FAILURE_MARKER}:c\\n");\n  return ${FAILURE_EXIT_CODE};\n}\n` },
  cpp: { file: 'fail.cpp', source: `#include <iostream>\n\nint main() {\n  std::cerr << "${FAILURE_MARKER}:cpp" << std::endl;\n  return ${FAILURE_EXIT_CODE};\n}\n` },
  java: {
    file: 'Fail.java',
    source: `public class Fail {\n  public static void main(String[] args) {\n    System.err.println("${FAILURE_MARKER}:java");\n    System.exit(${FAILURE_EXIT_CODE});\n  }\n}\n`,
  },
  ruby: { file: 'fail.rb', source: `$stderr.puts("${FAILURE_MARKER}:ruby")\nexit ${FAILURE_EXIT_CODE}\n` },
  php: { file: 'fail.php', source: `<?php\nfwrite(STDERR, "${FAILURE_MARKER}:php\\n");\nexit(${FAILURE_EXIT_CODE});\n` },
  bash: { file: 'fail.sh', source: `echo "${FAILURE_MARKER}:bash" >&2\nexit ${FAILURE_EXIT_CODE}\n` },
  lua: { file: 'fail.lua', source: `io.stderr:write("${FAILURE_MARKER}:lua\\n")\nos.exit(${FAILURE_EXIT_CODE})\n` },
  perl: { file: 'fail.pl', source: `print STDERR "${FAILURE_MARKER}:perl\\n";\nexit ${FAILURE_EXIT_CODE};\n` },
  powershell: { file: 'fail.ps1', source: `[Console]::Error.WriteLine("${FAILURE_MARKER}:powershell")\nexit ${FAILURE_EXIT_CODE}\n` },
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

export async function verifyRuntimes({ languages, timeoutMs = DEFAULT_TIMEOUT_MS, workRoot, failures = false } = {}) {
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

      if (!failures) continue;
      const failureFixture = RUNTIME_FAILURE_FIXTURES[language];
      await writeFile(path.join(root, failureFixture.file), failureFixture.source, 'utf8');
      const failure = await createLocalRunner().run(
        { jobId: `verify-${language}-fail-${randomUUID().slice(0, 8)}`, path: failureFixture.file, language, timeoutMs },
        { root },
      );
      // A failing program has to reach the user as a runtime failure, with the
      // code it chose and the words it wrote to stderr.
      const expectedFailure = `${FAILURE_MARKER}:${language}`;
      const stderr = `${failure.stderr ?? ''}${failure.compileStderr ?? ''}`;
      const reported = failure.status === 'JOB_STATUS_RUNTIME_FAILED'
        && failure.exitCode === FAILURE_EXIT_CODE
        && stderr.includes(expectedFailure);
      results.push({
        language, label: `${runtime.label} (failure)`, phase: 'failure',
        status: reported ? 'ok' : 'failed',
        jobStatus: failure.status, exitCode: failure.exitCode, durationMs: failure.durationMs,
        stdout: brief(failure.stdout), stderr: brief(stderr), hint: failure.hint ?? '',
        reason: reported ? '' : [
          `expected a runtime failure with exit ${FAILURE_EXIT_CODE} and its stderr`,
          `got ${failure.status} exit ${failure.exitCode ?? '-'}`,
          stderr.includes(expectedFailure) ? '' : 'without the program\'s stderr',
        ].filter(Boolean).join(', '),
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
  const failurePhase = results.some((result) => result.phase === 'failure');
  process.stdout.write(`\n${ran} runtimes verified${failurePhase ? ' (successes and failures)' : ''}, ${unavailable} unavailable, ${failed.length} failed\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const language = args.find((argument) => argument.startsWith('--language='))?.slice('--language='.length);
  const timeoutMs = Number(args.find((argument) => argument.startsWith('--timeout-ms='))?.slice('--timeout-ms='.length)) || DEFAULT_TIMEOUT_MS;
  const results = await verifyRuntimes({ languages: language ? [language] : undefined, timeoutMs, failures: args.includes('--failures') });
  if (json) process.stdout.write(`${JSON.stringify({ marker: MARKER, failureMarker: FAILURE_MARKER, results }, null, 2)}\n`);
  else render(results);
  process.exitCode = results.some((result) => result.status === 'failed' || result.status === 'unsupported') ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`verify-runtimes: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}