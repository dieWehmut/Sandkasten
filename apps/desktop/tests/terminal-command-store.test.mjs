import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { COMMAND_STORE_VERSION, createCommandStore } from '../src/terminal-command-store.mjs';

async function temporaryDirectory(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

test('a written catalog round-trips and leaves no temporary file behind', async (t) => {
  const root = await temporaryDirectory('sandkasten-command-store-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createCommandStore(path.join(root, 'terminal-commands.json'));

  assert.deepEqual(await store.read(), {}, 'a missing store is a cold start');
  await store.write({ bash: { at: 10, commands: ['ls', 'cd'] } });
  assert.deepEqual(await store.read(), { bash: { at: 10, commands: ['ls', 'cd'] } });
  assert.deepEqual(await readdir(root), ['terminal-commands.json'], 'the write is renamed into place');
});

test('a malformed, foreign or shapeless store is ignored instead of failing', async (t) => {
  const root = await temporaryDirectory('sandkasten-command-store-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'terminal-commands.json');
  const store = createCommandStore(file);

  await writeFile(file, '{ not json at all', 'utf8');
  assert.deepEqual(await store.read(), {});

  await writeFile(file, JSON.stringify({ version: COMMAND_STORE_VERSION + 1, profiles: { bash: { at: 1, commands: [] } } }), 'utf8');
  assert.deepEqual(await store.read(), {}, 'another version is a cold start');

  await writeFile(file, JSON.stringify({ version: COMMAND_STORE_VERSION, profiles: [] }), 'utf8');
  assert.deepEqual(await store.read(), {}, 'a list is not a profile map');

  await writeFile(file, JSON.stringify({ version: COMMAND_STORE_VERSION }), 'utf8');
  assert.deepEqual(await store.read(), {});
});