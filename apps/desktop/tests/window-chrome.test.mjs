import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import * as desktopIpc from '../src/ipc.mjs';

function harness({ platform = 'win32', zoom = 1 } = {}) {
  const handlers = new Map();
  const overlays = [];
  const backgrounds = [];
  const sent = [];
  const popups = [];
  const bundledIndex = path.resolve('apps/web/dist/index.html');
  const mainFrame = { url: pathToFileURL(bundledIndex).href };
  const webContents = {
    mainFrame,
    getZoomFactor: () => zoom,
    send: (...args) => sent.push(args),
  };
  const window = {
    webContents,
    isDestroyed: () => false,
    getContentSize: () => [1280, 860],
    setTitleBarOverlay: (options) => overlays.push(options),
    setBackgroundColor: (color) => backgrounds.push(color),
  };
  assert.equal(typeof desktopIpc.registerWindowChromeIpc, 'function', 'window chrome IPC must be registered');
  desktopIpc.registerWindowChromeIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    Menu: {
      buildFromTemplate: (template) => ({ popup: (options) => popups.push({ template, options }) }),
    },
    getWindowForContents: (contents) => contents === webContents ? window : undefined,
    bundledIndex,
    platform,
  });
  const event = { sender: webContents, senderFrame: mainFrame };
  return {
    event, window, webContents, overlays, backgrounds, sent, popups,
    invoke: async (channel, request, incoming = event) => {
      const handler = handlers.get(channel);
      assert.equal(typeof handler, 'function', `handler must exist for ${channel}`);
      return handler(incoming, request);
    },
  };
}

test('renderer themes synchronize native overlay controls and the window background', async () => {
  const app = harness();
  await app.invoke(desktopIpc.IPC_CHANNELS.chromeSetTheme, 'dark');
  await app.invoke(desktopIpc.IPC_CHANNELS.chromeSetTheme, 'light');
  assert.deepEqual(app.overlays, [
    { color: '#000000', symbolColor: '#f1f1f1', height: 40 },
    { color: '#ffffff', symbolColor: '#1a1c1f', height: 40 },
  ]);
  assert.deepEqual(app.backgrounds, ['#000000', '#ffffff']);
  await assert.rejects(() => app.invoke(desktopIpc.IPC_CHANNELS.chromeSetTheme, 'system'), /theme/i);
  await assert.rejects(() => app.invoke(desktopIpc.IPC_CHANNELS.chromeSetTheme, { color: '#ffffff' }), /theme/i);
  assert.equal(app.overlays.length, 2, 'invalid themes never reach native controls');
});

test('macOS updates the background without calling the Windows/Linux overlay API', async () => {
  const app = harness({ platform: 'darwin' });
  await app.invoke(desktopIpc.IPC_CHANNELS.chromeSetTheme, 'dark');
  assert.deepEqual(app.backgrounds, ['#000000']);
  assert.deepEqual(app.overlays, []);
});

test('only the bundled top-level frame can change chrome or open native menus', async () => {
  for (const [channel, request] of [
    ['chromeSetTheme', 'dark'],
    ['chromeShowMenu', { id: 'file', locale: 'en', x: 100, y: 40 }],
  ]) {
    for (const variant of ['unknown-window', 'subframe', 'remote-url', 'other-file', 'invalid-url', 'destroyed', 'missing-event']) {
      const app = harness();
      let incoming = { ...app.event };
      if (variant === 'unknown-window') incoming.sender = { mainFrame: app.event.senderFrame };
      if (variant === 'subframe') incoming.senderFrame = { ...app.event.senderFrame };
      if (variant === 'remote-url') incoming.senderFrame.url = 'https://example.com/index.html';
      if (variant === 'other-file') incoming.senderFrame.url = pathToFileURL(path.resolve('apps/web/dist/other.html')).href;
      if (variant === 'invalid-url') incoming.senderFrame.url = 'not-a-url';
      if (variant === 'destroyed') app.window.isDestroyed = () => true;
      if (variant === 'missing-event') incoming = null;
      await assert.rejects(() => app.invoke(desktopIpc.IPC_CHANNELS[channel], request, incoming), /trusted/i, variant);
      assert.deepEqual(app.overlays, []);
      assert.deepEqual(app.popups, []);
    }
  }
});

test('native menu popups use the requested locale, zoomed anchor, and originating window', async () => {
  const app = harness({ zoom: 1.25 });
  let closed = false;
  const result = app.invoke(desktopIpc.IPC_CHANNELS.chromeShowMenu, { id: 'file', locale: 'zh-CN', x: 80.4, y: 40 }).then(() => { closed = true; });
  await Promise.resolve();
  assert.equal(app.popups.length, 1);
  const popup = app.popups[0];
  assert.equal(popup.options.window, app.window);
  assert.equal(popup.options.frame, app.event.senderFrame);
  assert.equal(popup.options.x, 101);
  assert.equal(popup.options.y, 50);
  assert.equal(popup.template[0].label, '打开文件夹…');
  popup.template[0].click();
  assert.deepEqual(app.sent, [['sandkasten:menu', 'workspace.open']]);
  assert.equal(closed, false, 'the renderer keeps the menu active until native dismissal');
  popup.options.callback();
  await result;
  assert.equal(closed, true);
});

test('malformed menu names, locales, and out-of-window anchors never open popups', async () => {
  const app = harness({ zoom: 2 });
  const valid = { id: 'file', locale: 'en', x: 80, y: 40 };
  for (const request of [
    null, [], {}, { ...valid, id: 'quit' }, { ...valid, locale: 'fr' },
    { ...valid, x: '80' }, { ...valid, x: NaN }, { ...valid, y: Infinity },
    { ...valid, x: -1 }, { ...valid, y: -1 }, { ...valid, x: 641 }, { ...valid, y: 431 },
  ]) {
    await assert.rejects(() => app.invoke(desktopIpc.IPC_CHANNELS.chromeShowMenu, request), /menu|locale|anchor/i);
  }
  assert.deepEqual(app.popups, []);
});
