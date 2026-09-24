// The IDE status bar shows VS Code's problem counts. Sandkasten has no language
// server, so the counts summarize the last run instead of a diagnostics pass.

import { decodeOutput, type JobResponse } from '../services/sandkastenApi';
import { statusCategory } from './status';

export interface RunProblemCounts {
  errors: number;
  warnings: number;
}

const WARNING_LINE = /\bwarnings?\b/i;

function decoded(value: string | undefined, encoding: string | undefined): string {
  // Decoding follows the output panel's contract so base64 stderr is counted
  // from its text rather than from its base64 payload.
  return decodeOutput(value, encoding).text;
}

/**
 * A failed request or a run that failed counts as one error, a run that a
 * resource limit stopped counts as one warning, and every warning line the
 * compiler or interpreter wrote to stderr counts once. A canceled run is
 * neither, so pressing stop never looks like a broken program.
 */
export function runProblemCounts(job?: JobResponse | null, requestError?: string): RunProblemCounts {
  if (requestError) return { errors: 1, warnings: 0 };
  if (!job) return { errors: 0, warnings: 0 };

  const stderr = [
    decoded(job.stderr, job.stderrEncoding),
    decoded(job.compileStderr, job.compileStderrEncoding),
  ].join('\n');
  const category = statusCategory(job.status);
  return {
    errors: Boolean(job.errorMessage) || category === 'danger' ? 1 : 0,
    warnings: stderr.split('\n').filter((line) => WARNING_LINE.test(line)).length + (category === 'warning' ? 1 : 0),
  };
}