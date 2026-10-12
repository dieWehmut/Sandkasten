// An export nothing uses is either a leftover from a revert or a feature that was
// never wired up — this repository has had both, and the second is the expensive
// one. The scan is textual and deliberately lenient: a name mentioned in a comment,
// a test or a document counts as a use, so it reports the clear cases and leaves API
// arguments alone.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(appRoot, '..', '..');

/** Exports that are deliberately public without a caller inside this repository. */
const ALLOWED = new Set([]);

const TEXT_FILES = /\.(ts|mjs|cjs|vue|md|json|yml|yaml|sh)$/;
const SOURCE_FILES = /^apps\/(web|desktop|cli)\/src\/.*\.(ts|mjs|cjs)$/;
const DECLARATION = /^export (?:const|function|class|interface|type|enum|async function)\s+([A-Za-z_$][\w$]*)/gm;

function trackedFiles() {
  return execFileSync('git', ['ls-files'], { cwd: repositoryRoot, encoding: 'utf8' })
    .split('\n').map((line) => line.trim()).filter(Boolean);
}

function read(file) {
  try { return readFileSync(path.join(repositoryRoot, file), 'utf8'); } catch { return ''; }
}

test('every export has a reader somewhere in the repository', () => {
  const files = trackedFiles();
  const sources = files.filter((file) => SOURCE_FILES.test(file));
  assert.ok(sources.length >= 40, `expected the apps to have sources, saw ${sources.length}`);
  const corpus = files.filter((file) => TEXT_FILES.test(file)).map(read).join('\n');

  const unused = [];
  let checked = 0;
  for (const file of sources) {
    for (const match of read(file).matchAll(DECLARATION)) {
      const name = match[1];
      checked += 1;
      if (ALLOWED.has(name)) continue;
      // Every mention in the repository, minus the declaration itself.
      const mentions = [...corpus.matchAll(new RegExp(`\\b${name}\\b`, 'g'))].length;
      if (mentions <= 1) unused.push(`${file}: ${name}`);
    }
  }
  assert.ok(checked >= 200, `expected the apps to export their pieces, saw ${checked}`);
  assert.deepEqual(unused, []);
});

test('the allowlist names exports that still exist', () => {
  // A stale entry would hide the next dead export under a name nobody checks.
  const files = trackedFiles();
  const declarations = new Set();
  for (const file of files.filter((entry) => SOURCE_FILES.test(entry))) {
    for (const match of read(file).matchAll(DECLARATION)) declarations.add(match[1]);
  }
  const stale = [...ALLOWED].filter((name) => !declarations.has(name));
  assert.deepEqual(stale, []);
});