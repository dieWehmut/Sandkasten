// The handbuch tells operators which environment variables, flags and syscall
// constants matter. A name that no longer exists sends them looking for it in the
// code and not finding it, so every symbol the docs name is resolved against the
// repository. The two exceptions are constants the documents quote *about the
// platform* rather than about this repository.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(appRoot, '..', '..');

/**
 * Names a document quotes about the platform or a toolchain rather than about this
 * repository: two Linux constants, and the variable rustup reads to pick a
 * toolchain.
 */
const EXTERNAL_CONSTANTS = new Set(['CLOSE_RANGE_UNSHARE', 'UINT_MAX', 'RUSTUP_TOOLCHAIN']);

// This file names the allowlisted constants, so it is not evidence that they exist
// in the code — the first run passed only because the file was still untracked.
const SELF = 'apps/desktop/tests/doc-symbols.test.mjs';

const SYMBOL = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;

// The plans and specs under `docs/superpowers/` are dated records of what was
// intended at the time, including names that were never implemented. Every other
// document is a promise to a reader, so those are what this test resolves.
const DATED_RECORDS = 'docs/superpowers/';

/** The documents whose symbols are promises: everything except the dated records. */
function promiseDocuments(files) {
  return files.filter((file) => file.endsWith('.md') && !file.startsWith(DATED_RECORDS));
}

function trackedFiles() {
  return execFileSync('git', ['ls-files'], { cwd: repositoryRoot, encoding: 'utf8' })
    .split('\n').map((line) => line.trim()).filter(Boolean);
}

test('every symbol the documentation names exists somewhere in the repository', () => {
  const files = trackedFiles();
  const docs = promiseDocuments(files);
  assert.ok(docs.length >= 8, `expected reader-facing documents, saw ${docs.length}`);
  const corpus = files
    .filter((file) => !docs.includes(file) && file !== SELF)
    .map((file) => { try { return readFileSync(path.join(repositoryRoot, file), 'utf8'); } catch { return ''; } })
    .join('\n');

  const unknown = [];
  let checked = 0;
  for (const doc of docs) {
    const text = readFileSync(path.join(repositoryRoot, doc), 'utf8');
    for (const symbol of new Set([...text.matchAll(SYMBOL)].map((match) => match[0]))) {
      if (EXTERNAL_CONSTANTS.has(symbol)) continue;
      checked += 1;
      if (!corpus.includes(symbol)) unknown.push(`${doc}: ${symbol}`);
    }
  }
  // A parse that finds nothing would pass for the wrong reason.
  assert.ok(checked >= 50, `expected the documentation to name its symbols, saw ${checked}`);
  assert.deepEqual(unknown, []);
});

test('the external-constant list only holds constants the documents quote', () => {
  // Each entry has to be absent from the repository and present in the docs, so the
  // list cannot quietly absorb a name that really did disappear from the code.
  const files = trackedFiles();
  const docs = promiseDocuments(files);
  const docText = docs.map((file) => readFileSync(path.join(repositoryRoot, file), 'utf8')).join('\n');
  const corpus = files
    .filter((file) => !docs.includes(file) && file !== SELF)
    .map((file) => { try { return readFileSync(path.join(repositoryRoot, file), 'utf8'); } catch { return ''; } })
    .join('\n');
  for (const name of EXTERNAL_CONSTANTS) {
    assert.ok(docText.includes(name), `${name} is listed as external but no document quotes it`);
    assert.equal(corpus.includes(name), false, `${name} exists in the repository, so it is not external`);
  }
});