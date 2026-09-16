import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { createWindowOptions, isBundledUrl, shouldOpenExternally } from '../src/navigation.mjs';

const bundledIndex = path.resolve('/srv/apps/web/dist/index.html');

test('bundled URLs stay in the window', () => {
  assert.equal(isBundledUrl(pathToFileURL(bundledIndex).href, bundledIndex), true);
  assert.equal(isBundledUrl('file:///srv/apps/web/dist/app.js', bundledIndex), true);
  assert.equal(isBundledUrl('file:///srv/apps/web/dist/nested/asset.css', bundledIndex), true);
});

test('external origins are denied and handed to the OS browser', () => {
  assert.equal(isBundledUrl('https://example.com/', bundledIndex), false);
  assert.equal(isBundledUrl('http://127.0.0.1:8080/v1/runtimes', bundledIndex), false);
  assert.equal(isBundledUrl('file:///etc/passwd', bundledIndex), false);
  assert.equal(shouldOpenExternally('https://run.example.com'), true);
  assert.equal(shouldOpenExternally('http://example.com'), true);
  assert.equal(shouldOpenExternally('file:///srv/apps/web/dist/index.html'), false);
  assert.equal(shouldOpenExternally('javascript:alert(1)'), false);
  assert.equal(shouldOpenExternally(undefined), false);
});

test('window options keep isolation, sandboxing, and no Node integration', () => {
  const options = createWindowOptions({ preloadPath: '/srv/apps/desktop/src/preload.mjs' });
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.sandbox, true);
  assert.equal(options.webPreferences.preload, '/srv/apps/desktop/src/preload.mjs');
  assert.equal(options.webPreferences.webSecurity, true);
  assert.equal(options.show, false);
});
