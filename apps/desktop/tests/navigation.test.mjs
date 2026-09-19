import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import * as navigation from '../src/navigation.mjs';

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

test('Windows and Linux place native window controls in the integrated header', () => {
  for (const platform of ['win32', 'linux']) {
    const options = createWindowOptions({ platform });
    assert.equal(options.titleBarStyle, 'hidden');
    assert.equal(options.autoHideMenuBar, true);
    assert.deepEqual(options.titleBarOverlay, { color: '#f0f5f1', symbolColor: '#1a1c1f', height: 40 });
    assert.equal(options.backgroundColor, '#f0f5f1');
    assert.equal(options.frame, undefined, 'keep native resize and window controls');
  }
});

test('macOS retains native traffic lights inside the integrated header', () => {
  const options = createWindowOptions({ platform: 'darwin' });
  assert.equal(options.titleBarStyle, 'hidden');
  assert.deepEqual(options.trafficLightPosition, { x: 12, y: 13 });
  assert.equal(options.titleBarOverlay, undefined, 'macOS uses the native traffic lights');
});

test('the integrated header hides the native menu row even on bare Alt without blocking shortcuts', () => {
  const listeners = new Map();
  const visibility = [];
  const window = {
    setMenuBarVisibility: (visible) => visibility.push(visible),
    webContents: { on: (event, handler) => listeners.set(event, handler) },
  };
  assert.equal(typeof navigation.applyWindowChromePolicy, 'function');
  navigation.applyWindowChromePolicy({ window, platform: 'win32' });
  assert.deepEqual(visibility, [false]);
  const onInput = listeners.get('before-input-event');
  assert.equal(typeof onInput, 'function');
  const prevented = (input) => {
    let value = false;
    onInput({ preventDefault: () => { value = true; } }, input);
    return value;
  };
  assert.equal(prevented({ type: 'keyDown', key: 'Alt', alt: true }), true);
  assert.equal(prevented({ type: 'keyUp', key: 'Alt', alt: false }), true);
  assert.equal(prevented({ type: 'keyDown', key: 's', control: true }), false);
  assert.equal(prevented({ type: 'keyDown', key: 'F5' }), false);
  assert.equal(prevented({ type: 'keyDown', key: 'F4', alt: true }), false);
  assert.equal(prevented({ type: 'keyDown', key: 'Alt', alt: true, control: true }), false, 'AltGr input remains available');
  assert.equal(prevented({ type: 'keyDown', key: 'Alt', alt: true, shift: true }), false, 'IME switching remains available');
});

test('macOS keeps its system menu and Option-key handling', () => {
  let changed = false;
  assert.equal(typeof navigation.applyWindowChromePolicy, 'function');
  navigation.applyWindowChromePolicy({
    window: {
      setMenuBarVisibility: () => { changed = true; },
      webContents: { on: () => { changed = true; } },
    },
    platform: 'darwin',
  });
  assert.equal(changed, false);
});
