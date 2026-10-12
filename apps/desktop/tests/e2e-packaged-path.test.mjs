import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolvePackagedExecutable } from '../scripts/e2e-ide.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(appRoot, '..', '..');

test('the packaged executable path may be relative to the repository root', () => {
  // This is the form the README documents, and the one that used to reach
  // Playwright unresolved: the run failed with "Process failed to launch!".
  assert.equal(resolvePackagedExecutable('apps/desktop/package.json'), path.join(repositoryRoot, 'apps', 'desktop', 'package.json'));
});

test('a path relative to the app, or an absolute one, still works', () => {
  assert.equal(resolvePackagedExecutable('package.json'), path.join(appRoot, 'package.json'));
  assert.equal(resolvePackagedExecutable(path.join(appRoot, 'package.json')), path.join(appRoot, 'package.json'));
});

test('an executable that is not there fails with every path that was tried', () => {
  assert.equal(resolvePackagedExecutable(undefined), undefined);
  assert.throws(() => resolvePackagedExecutable('tmp/desktop-dist/nowhere/Sandkasten.exe'), /was not found\. Tried: .*nowhere/);
});