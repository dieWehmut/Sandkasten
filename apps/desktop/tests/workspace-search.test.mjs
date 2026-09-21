import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { searchWorkspaceFiles } from '../src/workspace-search.mjs';

async function temporaryDirectory(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

test('search walks the open folder, ignores heavy directories, and reports line matches', async (t) => {
  const root = await temporaryDirectory('sandkasten-search-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'pkg'));
  await mkdir(path.join(root, 'node_modules'));
  await writeFile(path.join(root, 'main.py'), 'print("alpha")\nprint("beta")\n');
  await writeFile(path.join(root, 'pkg', 'util.py'), 'def alpha():\n    return alpha\n');
  await writeFile(path.join(root, 'node_modules', 'dep.js'), 'const alpha = 1;\n');
  await writeFile(path.join(root, 'notes.txt'), 'alpha\n');
  await writeFile(path.join(root, 'binary.bin'), Buffer.from([0x00, 0x61, 0x6c, 0x70, 0x68, 0x61, 0x00]));

  const result = await searchWorkspaceFiles(root, 'alpha');
  // One entry per matching line, ordered by path, with the line and its text.
  assert.deepEqual(result.files.map((file) => file.path), ['main.py', 'notes.txt', 'pkg/util.py']);
  assert.deepEqual(result.files.map((file) => file.name), ['main.py', 'notes.txt', 'util.py']);
  assert.deepEqual(result.files.map((file) => file.matches.length), [1, 1, 2]);
  assert.deepEqual(result.files[0].matches, [{ line: 1, text: 'print("alpha")' }]);
  assert.deepEqual(result.files[2].matches, [
    { line: 1, text: 'def alpha():' },
    { line: 2, text: 'return alpha' },
  ]);
  // Ignored directories are never searched, and a NUL byte marks a binary file.
  assert.equal(result.files.some((file) => file.path.startsWith('node_modules/')), false);
  assert.equal(result.files.some((file) => file.path === 'binary.bin'), false);
  assert.equal(result.truncated, false);
  assert.equal(result.fileCount, 3);
  assert.equal(result.matchCount, 4);
});

test('search honours case sensitivity and bounds its result set loudly', async (t) => {
  const root = await temporaryDirectory('sandkasten-search-cap-');
  t.after(() => rm(root, { recursive: true, force: true }));
  for (let index = 0; index < 8; index += 1) {
    await writeFile(path.join(root, `file-${index}.py`), 'Needle\nneedle\n');
  }

  // One result per matching line, so the mixed-case file contributes two rows
  // to the insensitive search and one to the sensitive one.
  const insensitive = await searchWorkspaceFiles(root, 'needle');
  assert.equal(insensitive.fileCount, 8);
  assert.equal(insensitive.matchCount, 16);

  const sensitive = await searchWorkspaceFiles(root, 'Needle', { caseSensitive: true });
  assert.equal(sensitive.fileCount, 8);
  assert.equal(sensitive.matchCount, 8);

  const capped = await searchWorkspaceFiles(root, 'needle', { maxMatches: 3 });
  assert.equal(capped.truncated, true);
  assert.equal(capped.matchCount, 3);
  assert.equal(capped.fileCount, 2);
});

test('search rejects an empty query and refuses a folder that is not open', async () => {
  await assert.rejects(() => searchWorkspaceFiles(os.tmpdir(), '   '), /search query/i);
  await assert.rejects(() => searchWorkspaceFiles(path.join(os.tmpdir(), 'sandkasten-missing-search-1'), 'x'), /not found/i);
});
