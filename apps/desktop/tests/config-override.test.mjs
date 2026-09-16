import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { prepareDistribution } from '../src/config-override.mjs';

async function createSource() {
  const source = await mkdtemp(path.join(tmpdir(), 'sandkasten-desktop-dist-'));
  for (const name of ['index.html', 'app.js', 'styles.css', 'config.js']) {
    await writeFile(path.join(source, name), name === 'config.js' ? "globalThis.SANDKASTEN_CONFIG ??= { apiBaseUrl: '' };\n" : `content of ${name}`);
  }
  return source;
}

test('an empty base URL loads the bundled distribution directly', async () => {
  const source = await createSource();
  const stageRoot = await mkdtemp(path.join(tmpdir(), 'sandkasten-desktop-stage-'));
  try {
    const unchanged = await prepareDistribution(source, { apiBaseUrl: '', stageRoot });
    assert.equal(unchanged, source);
    assert.equal(await readFile(path.join(source, 'config.js'), 'utf8'), "globalThis.SANDKASTEN_CONFIG ??= { apiBaseUrl: '' };\n");
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(stageRoot, { recursive: true, force: true });
  }
});

test('a configured base URL stages a reusable copy without rewriting the bundle', async () => {
  const source = await createSource();
  const stageRoot = await mkdtemp(path.join(tmpdir(), 'sandkasten-desktop-stage-'));
  try {
    const staged = await prepareDistribution(source, { apiBaseUrl: 'https://run.example.com', stageRoot });
    assert.notEqual(staged, source);
    assert.match(await readFile(path.join(staged, 'config.js'), 'utf8'), /^globalThis\.SANDKASTEN_CONFIG = \{ apiBaseUrl: "https:\/\/run\.example\.com" \};\n$/);
    assert.equal(await readFile(path.join(staged, 'app.js'), 'utf8'), 'content of app.js');
    assert.equal(await readFile(path.join(source, 'config.js'), 'utf8'), "globalThis.SANDKASTEN_CONFIG ??= { apiBaseUrl: '' };\n");

    const again = await prepareDistribution(source, { apiBaseUrl: 'https://other.example.com', stageRoot });
    assert.equal(again, staged, 'repeated launches reuse one stable stage directory');
    assert.match(await readFile(path.join(staged, 'config.js'), 'utf8'), /other\.example\.com/);
    assert.equal((await readdir(stageRoot)).length, 1, 'staging must not accumulate directories');
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(stageRoot, { recursive: true, force: true });
  }
});

test('escapes quotes and rejects newline injection', async () => {
  const source = await createSource();
  const stageRoot = await mkdtemp(path.join(tmpdir(), 'sandkasten-desktop-stage-'));
  try {
    const staged = await prepareDistribution(source, { apiBaseUrl: 'https://run.example.com/a"b', stageRoot });
    assert.match(await readFile(path.join(staged, 'config.js'), 'utf8'), /a\\"b/);
    await assert.rejects(
      () => prepareDistribution(source, { apiBaseUrl: 'https://x.example.com\nalert(1)', stageRoot }),
      /newline/i,
    );
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(stageRoot, { recursive: true, force: true });
  }
});
