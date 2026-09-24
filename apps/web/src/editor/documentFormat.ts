// Document facts the IDE status bar reports beside the cursor: indentation, line
// ending, and encoding. The buffer is plain text in CodeMirror and the API
// submission contract is UTF-8, so the bar describes what the document actually
// contains rather than a project-wide editor setting.

export type LineEnding = 'LF' | 'CRLF';

export interface Indentation {
  kind: 'spaces' | 'tabs';
  size: number;
}

/** Sandkasten submits UTF-8 source, so the status bar states it outright. */
export const SOURCE_ENCODING = 'UTF-8';

/** VS Code's own fallback when a document carries no indentation to learn from. */
export const DEFAULT_INDENTATION: Indentation = { kind: 'spaces', size: 4 };

// The candidates VS Code's indentation guesser scores.
const INDENT_CANDIDATES = [2, 4, 6, 8] as const;

/**
 * Guess the document's indent unit the way "detect indentation" does in VS Code:
 * every indented line votes for each candidate its width divides evenly, and the
 * widest candidate with the most votes wins. A tab-indented document reports
 * tabs, and a document without indentation keeps the default.
 */
export function detectIndentation(source: string): Indentation {
  const widths: number[] = [];
  for (const line of String(source ?? '').split(/\r\n|\r|\n/)) {
    const leading = /^[ \t]*/.exec(line)?.[0] ?? '';
    if (!leading || !line.trim()) continue;
    if (leading.includes('\t')) return { kind: 'tabs', size: DEFAULT_INDENTATION.size };
    widths.push(leading.length);
  }
  if (!widths.length) return DEFAULT_INDENTATION;

  let best: number = INDENT_CANDIDATES[0];
  let bestScore = -1;
  for (const candidate of INDENT_CANDIDATES) {
    const score = widths.filter((width) => width % candidate === 0).length;
    // Candidates ascend, so `>=` keeps the widest unit on a tie: a four-space
    // document is never reported as two-space just because every line is even.
    if (score >= bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return { kind: 'spaces', size: best };
}

/** Report the line ending the document mostly uses; `LF` when it has none. */
export function detectLineEnding(source: string): LineEnding {
  const text = String(source ?? '');
  const lineFeeds = text.match(/\n/g)?.length ?? 0;
  const crlf = text.match(/\r\n/g)?.length ?? 0;
  return lineFeeds > 0 && crlf * 2 > lineFeeds ? 'CRLF' : 'LF';
}