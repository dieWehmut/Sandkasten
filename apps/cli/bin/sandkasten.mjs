#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { InputError, parseArgs, UsageError } from '../src/args.mjs';
import { ApiError, fetchRuntimes, pollJob, submitJob } from '../src/api.mjs';
import { formatJobHuman, formatJobJson, formatRuntimesHuman, formatRuntimesJson, jobExitCode } from '../src/output.mjs';

const extensionLanguages = new Map([
  ['.bash', 'bash'],
  ['.c', 'c'],
  ['.cpp', 'cpp'],
  ['.cs', 'csharp'],
  ['.dart', 'dart'],
  ['.exs', 'elixir'],
  ['.fs', 'fsharp'],
  ['.f90', 'fortran'],
  ['.go', 'go'],
  ['.hs', 'haskell'],
  ['.html', 'html'],
  ['.java', 'java'],
  ['.jl', 'julia'],
  ['.js', 'javascript'],
  ['.kt', 'kotlin'],
  ['.lua', 'lua'],
  ['.md', 'markdown'],
  ['.ml', 'ocaml'],
  ['.nim', 'nim'],
  ['.php', 'php'],
  ['.pl', 'perl'],
  ['.py', 'python'],
  ['.r', 'r'],
  ['.rb', 'ruby'],
  ['.rs', 'rust'],
  ['.scala', 'scala'],
  ['.sh', 'bash'],
  ['.sql', 'sql'],
  ['.swift', 'swift'],
  ['.ts', 'typescript'],
  ['.tsx', 'tsx'],
  ['.vue', 'vue3'],
  ['.zig', 'zig'],
]);

function inferLanguage(file) {
  return extensionLanguages.get(path.extname(file).toLowerCase());
}

export const EXIT_SUCCESS = 0;
export const EXIT_JOB_FAILED = 1;
export const EXIT_USAGE = 2;
export const EXIT_API = 3;

async function readSource(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    throw new InputError(`cannot read source file ${file}: ${error.code ?? error.message}`);
  }
}

export async function execute(parsed, streams = {}) {
  const out = streams.out ?? ((text) => process.stdout.write(text));
  const err = streams.err ?? ((text) => process.stderr.write(text));
  const { command } = parsed;
  const options = { ...parsed.options, apiBaseUrl: parsed.options.api };

  if (command === 'runtimes') {
    const runtimes = await fetchRuntimes(options);
    out(options.json ? formatRuntimesJson(runtimes) : formatRuntimesHuman(runtimes));
    return EXIT_SUCCESS;
  }

  if (command === 'run') {
    const source = await readSource(parsed.file);
    const language = options.language ?? inferLanguage(parsed.file) ?? 'go';
    const job = await submitJob({ ...options, language, source });
    err(`submitted ${job.jobId} (${job.status ?? 'unknown'})\n`);
    const finished = await pollJob({
      ...options,
      jobId: job.jobId,
      onUpdate: (update) => err(`status: ${update.status}\n`),
    });
    out(options.json ? formatJobJson(finished) : formatJobHuman(finished));
    return jobExitCode(finished);
  }

  if (command === 'job') {
    const finished = await pollJob({ ...options, jobId: parsed.jobId });
    out(options.json ? formatJobJson(finished) : formatJobHuman(finished));
    return jobExitCode(finished);
  }

  throw new UsageError(`unknown command: ${command}`);
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UsageError) {
      if (error.message !== '') process.stderr.write(`${error.message}\n`);
      process.exitCode = EXIT_USAGE;
      return;
    }
    throw error;
  }

  try {
    process.exitCode = await execute(parsed);
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = EXIT_USAGE;
      return;
    }
    if (error instanceof InputError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = EXIT_USAGE;
      return;
    }
    if (error instanceof ApiError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = EXIT_API;
      return;
    }
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
