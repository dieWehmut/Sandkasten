import assert from 'node:assert/strict';
import test from 'node:test';

import config, { NSIS_ARCHIVE_FILTER } from '../electron-builder.config.mjs';

test('the Windows target builds an assisted NSIS installer for both architectures', () => {
  assert.deepEqual(config.win.target, [{ target: 'nsis', arch: ['x64', 'arm64'] }]);
});

test('the installer creates desktop and start menu shortcuts', () => {
  assert.equal(config.nsis.createDesktopShortcut, true);
  assert.equal(config.nsis.createStartMenuShortcut, true);
  assert.equal(config.nsis.shortcutName, 'Sandkasten');
  assert.equal(config.nsis.oneClick, false);
  assert.equal(config.nsis.perMachine, false);
  assert.equal(config.nsis.allowToChangeInstallationDirectory, true);
  assert.equal(config.nsis.artifactName, 'Sandkasten-${version}-Setup.${ext}');
});

test('pins a 7-Zip filter the bundled NSIS plugin can decompress', () => {
  assert.equal(NSIS_ARCHIVE_FILTER, 'BCJ');
  assert.equal(process.env.ELECTRON_BUILDER_7Z_FILTER, 'BCJ');
});

test('bundles the web distribution next to the packaged app', () => {
  assert.equal(config.extraResources.length, 1);
  assert.equal(config.extraResources[0].to, 'web-dist');
  assert.match(config.extraResources[0].from, /apps[\\/]web[\\/]dist$/);
});
