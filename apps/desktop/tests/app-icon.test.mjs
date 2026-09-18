import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import config from '../electron-builder.config.mjs';
import { createWindowOptions } from '../src/navigation.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDirectory = path.join(appRoot, 'build');

test('the packaged Windows installer ships a multi-size icon', () => {
  const ico = path.join(buildDirectory, 'icon.ico');
  assert.equal(statSync(ico).isFile(), true, 'build/icon.ico must exist');
  assert.ok(statSync(ico).size > 0, 'build/icon.ico must not be empty');
  assert.ok(config.win.icon, 'the Windows target must point at the icon');
  assert.equal(path.basename(config.win.icon), 'icon.ico');
});

test('the window uses the same brand icon as the installer', () => {
  const options = createWindowOptions({ preloadPath: '/srv/apps/desktop/src/preload.cjs' });
  assert.ok(options.icon, 'the window must set an icon');
  assert.equal(path.basename(options.icon), 'icon.png');
  assert.equal(statSync(options.icon).isFile(), true);
});
