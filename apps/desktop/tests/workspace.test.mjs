import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createWorkspaceFile,
  createWorkspaceSession,
  deleteWorkspaceFile,
  listWorkspaceTree,
  normalizeRelativePath,
  readWorkspaceFile,
  resolveInsideRoot,
  writeWorkspaceFile,
} from '../src/workspace.mjs';

async function temporaryDirectory(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

test('workspace paths stay inside the opened folder', () => {
  const root = path.resolve('/srv/workspace');
  assert.equal(resolveInsideRoot(root, 'main.py'), path.join(root, 'main.py'));
  assert.equal(resolveInsideRoot(root, 'pkg/util.py'), path.join(root, 'pkg', 'util.py'));
  assert.equal(resolveInsideRoot(root, 'pkg\\util.py'), path.join(root, 'pkg', 'util.py'));

  for (const candidate of [
    '../escape.py',
    'pkg/../../escape.py',
    '/etc/passwd',
    'C:/Windows/system32/cmd.exe',
    '',
    '   ',
    'nul\0byte.py',
  ]) {
    assert.throws(() => resolveInsideRoot(root, candidate), /workspace/i, `${candidate} must be rejected`);
  }
});

test('relative paths are normalized without losing segments', () => {
  assert.equal(normalizeRelativePath('./pkg/./util.py'), 'pkg/util.py');
  assert.equal(normalizeRelativePath('pkg//util.py'), 'pkg/util.py');
  assert.equal(normalizeRelativePath('pkg\\util.py'), 'pkg/util.py');
});

test('the workspace tree skips heavy directories and lists directories first', async (t) => {
  const root = await temporaryDirectory('sandkasten-tree-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'pkg'), { recursive: true });
  await mkdir(path.join(root, 'node_modules', 'left-pad'), { recursive: true });
  await mkdir(path.join(root, '.git'), { recursive: true });
  await writeFile(path.join(root, 'zeta.py'), 'print(1)\n');
  await writeFile(path.join(root, 'alpha.py'), 'print(2)\n');
  await writeFile(path.join(root, 'pkg', 'util.py'), 'print(3)\n');
  await writeFile(path.join(root, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1;\n');

  const { tree, truncated } = await listWorkspaceTree(root);
  assert.equal(truncated, false);
  assert.deepEqual(tree.map((node) => node.name), ['pkg', 'alpha.py', 'zeta.py']);
  assert.deepEqual(tree[0].children.map((node) => node.path), ['pkg/util.py']);
});

test('file operations round-trip inside the workspace', async (t) => {
  const root = await temporaryDirectory('sandkasten-files-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'main.py'), 'print("hello")\n');

  assert.equal(await readWorkspaceFile(root, 'main.py'), 'print("hello")\n');
  await writeWorkspaceFile(root, 'main.py', 'print("updated")\n');
  assert.equal(await readFile(path.join(root, 'main.py'), 'utf8'), 'print("updated")\n');

  await createWorkspaceFile(root, 'nested/new.py', 'print("new")\n');
  assert.equal(await readWorkspaceFile(root, 'nested/new.py'), 'print("new")\n');
  await assert.rejects(() => createWorkspaceFile(root, 'nested/new.py', ''), /already exists/);

  await deleteWorkspaceFile(root, 'nested/new.py');
  await assert.rejects(() => readWorkspaceFile(root, 'nested/new.py'), /not found/);
  await assert.rejects(() => writeWorkspaceFile(root, 'missing.py', 'x'), /not found/);
  await assert.rejects(() => readWorkspaceFile(root, '../outside.py'), /workspace/i);
});

test('file writes are bounded by the workspace size limit', async (t) => {
  const root = await temporaryDirectory('sandkasten-size-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'big.py'), '');
  await assert.rejects(() => writeWorkspaceFile(root, 'big.py', 'x'.repeat(2 * 1024 * 1024 + 1)), /2 MiB/);
});

test('a workspace session remembers and restores the opened folder', async (t) => {
  const root = await temporaryDirectory('sandkasten-session-');
  const storeRoot = await temporaryDirectory('sandkasten-store-');
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(storeRoot, { recursive: true, force: true }));
  const storeFile = path.join(storeRoot, 'workspace.json');

  const session = createWorkspaceSession({ storeFile });
  assert.equal(session.current(), null);
  assert.equal(await session.restore(), null);
  const opened = await session.setRoot(root);
  assert.equal(opened.path, path.resolve(root));
  assert.equal(opened.name, path.basename(root));

  const reopened = createWorkspaceSession({ storeFile });
  assert.equal((await reopened.restore())?.path, path.resolve(root));
  assert.equal(await reopened.clear(), null);
  assert.equal(await createWorkspaceSession({ storeFile }).restore(), null);
});

test('a missing folder is rejected instead of silently cleared', async () => {
  const session = createWorkspaceSession();
  await assert.rejects(() => session.setRoot(path.join(os.tmpdir(), 'sandkasten-does-not-exist-42')), /not found/);
});