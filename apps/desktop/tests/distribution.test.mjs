import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { DISTRIBUTION_FILES, resolveDistributionDirectory, verifyDistribution } from '../src/distribution.mjs';

async function createDistribution(directory) {
  await mkdir(directory, { recursive: true });
  for (const name of DISTRIBUTION_FILES) await writeFile(path.join(directory, name), '');
  return directory;
}

test('resolves the repository distribution from the desktop app root', () => {
  const appRoot = path.resolve('/srv/sandkasten/apps/desktop');
  assert.equal(
    resolveDistributionDirectory({ appRoot }),
    path.resolve('/srv/sandkasten/apps/web/dist'),
  );
});

test('resolves the packaged distribution from process.resourcesPath', () => {
  const appRoot = path.resolve('/opt/Sandkasten/resources/app.asar.unpacked/apps/desktop');
  assert.equal(
    resolveDistributionDirectory({ appRoot, resourcesPath: '/opt/Sandkasten/resources' }),
    path.resolve('/opt/Sandkasten/resources/web-dist'),
  );
});

test('accepts a complete four-file distribution', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sandkasten-desktop-'));
  try {
    const directory = await createDistribution(path.join(root, 'web-dist'));
    assert.equal(await verifyDistribution(directory), directory);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects a missing or incomplete distribution', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sandkasten-desktop-'));
  try {
    await assert.rejects(() => verifyDistribution(path.join(root, 'missing')), /not found/i);
    const partial = await createDistribution(path.join(root, 'partial'));
    await rm(path.join(partial, 'app.js'));
    await assert.rejects(() => verifyDistribution(partial), /app\.js/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
