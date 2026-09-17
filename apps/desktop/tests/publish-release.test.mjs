import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { planRelease } from '../scripts/publish-release.mjs';

test('derives the tag, title, and asset path from the desktop version', () => {
  const plan = planRelease({ version: '0.1.0', repositoryRoot: path.resolve('/srv/sandkasten') });
  assert.equal(plan.tag, 'v0.1.0');
  assert.equal(plan.name, 'Sandkasten 0.1.0');
  assert.deepEqual(plan.files, [path.join(path.resolve('/srv/sandkasten'), 'tmp', 'desktop-dist', 'Sandkasten-0.1.0-Setup.exe')]);
});
