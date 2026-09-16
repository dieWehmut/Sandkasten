import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createPreviewServer, resolveOptions } from '../scripts/serve.mjs';

async function createDistribution() {
  const directory = await mkdtemp(path.join(tmpdir(), 'sandkasten-serve-'));
  for (const [name, body] of Object.entries({
    'index.html': '<!doctype html><div id="app"></div>',
    'app.js': 'globalThis.__PREVIEW__ = true;',
    'styles.css': ':root {}',
    'config.js': "globalThis.SANDKASTEN_CONFIG ??= { apiBaseUrl: '' };",
  })) {
    await writeFile(path.join(directory, name), body);
  }
  return directory;
}

async function startServer(options = {}) {
  const server = await createPreviewServer(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return { server, origin: `http://127.0.0.1:${port}` };
}

test('serves the four distribution files with no-store caching', async () => {
  const directory = await createDistribution();
  const { server, origin } = await startServer({ directory });
  try {
    for (const name of ['index.html', 'app.js', 'styles.css', 'config.js']) {
      const response = await fetch(`${origin}/${name}`);
      assert.equal(response.status, 200, `${name} must be served`);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    const index = await fetch(`${origin}/`).then((response) => response.text());
    assert.match(index, /id="app"/);
  } finally {
    server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects path traversal and missing files without leaking the filesystem', async () => {
  const directory = await createDistribution();
  const outside = path.join(directory, '..', 'sandkasten-serve-secret.txt');
  await writeFile(outside, 'secret');
  const { server, origin } = await startServer({ directory });
  try {
    const traversal = await fetch(`${origin}/../sandkasten-serve-secret.txt`);
    assert.equal(traversal.status, 404);
    const missing = await fetch(`${origin}/nope.js`);
    assert.equal(missing.status, 404);
    const nested = await fetch(`${origin}/..%2f..%2fetc%2fpasswd`);
    assert.equal(nested.status, 404);
  } finally {
    server.close();
    await rm(outside, { force: true });
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects non-read distribution roots', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'sandkasten-serve-'));
  try {
    await assert.rejects(() => createPreviewServer({ directory }), /distribution/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('resolveOptions defaults to port 4173 and accepts flags', () => {
  assert.deepEqual(resolveOptions([], {}), { directory: null, host: '127.0.0.1', port: 4173 });
  assert.deepEqual(resolveOptions(['--port', '5000', '--host', '0.0.0.0'], {}), { directory: null, host: '0.0.0.0', port: 5000 });
  assert.deepEqual(resolveOptions(['--directory', 'out'], {}), { directory: 'out', host: '127.0.0.1', port: 4173 });
  assert.throws(() => resolveOptions(['--port', 'abc'], {}), /port/i);
});
