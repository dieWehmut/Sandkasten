import assert from 'node:assert/strict';
import test from 'node:test';

import { applyCloseToTrayPolicy, createAppTray, showMainWindow, trayMenuTemplate } from '../src/tray.mjs';

function windowStub() {
  const shown = [];
  const focused = [];
  const hidden = [];
  const restored = [];
  return {
    shown, focused, hidden, restored,
    isDestroyed: () => false,
    isMinimized: () => false,
    show: () => shown.push(true),
    focus: () => focused.push(true),
    hide: () => hidden.push(true),
    restore: () => restored.push(true),
    on: () => {},
  };
}

function trayHarness({ platform = 'win32', windows } = {}) {
  const handlers = new Map();
  const contexts = [];
  const tooltips = [];
  const icons = [];
  const destroyed = [];
  const template = windowStub();
  const list = windows ?? [template];
  const tray = {
    setToolTip: (value) => tooltips.push(value),
    setContextMenu: (menu) => contexts.push(menu),
    on: (event, handler) => handlers.set(event, handler),
    destroy: () => destroyed.push(true),
  };
  const instance = createAppTray({
    Tray: class { constructor(icon) { icons.push(icon); return tray; } },
    Menu: { buildFromTemplate: (value) => ({ value }) },
    nativeImage: { createFromPath: (value) => `image:${value}` },
    iconPath: '/tmp/icon.png',
    platform,
    locale: 'en',
    getAllWindows: () => list,
    sendCommand: () => {},
    quit: () => {},
  });
  return { instance, handlers, contexts, tooltips, icons, destroyed, window: template };
}

test('the tray is built from the brand icon with a tooltip and both click handlers', () => {
  const app = trayHarness();
  assert.ok(app.instance);
  assert.deepEqual(app.icons, ['image:/tmp/icon.png']);
  assert.deepEqual(app.tooltips, ['Sandkasten']);
  assert.equal(typeof app.handlers.get('click'), 'function', 'a left click must be handled');
  assert.equal(typeof app.handlers.get('right-click'), 'function', 'a right click must be handled');
  assert.equal(app.contexts.length, 1, 'the settings menu is attached to the tray');
});

test('a left click restores and focuses the existing window instead of opening another one', () => {
  const app = trayHarness();
  app.handlers.get('click')();
  assert.deepEqual(app.window.shown, [true]);
  assert.deepEqual(app.window.focused, [true]);
  assert.equal(showMainWindow({ getAllWindows: () => [app.window] }), true);
});

test('a hidden window is shown again and a missing window asks to be recreated', () => {
  const app = trayHarness({ windows: [] });
  assert.equal(showMainWindow({ getAllWindows: () => [] }), false, 'no window and no factory means nothing to show');
  let created = 0;
  assert.equal(showMainWindow({ getAllWindows: () => [], createWindow: () => { created += 1; } }), true);
  assert.equal(created, 1, 'the tray recreates the window when the previous one is gone');
  assert.equal(showMainWindow({ getAllWindows: () => [app.window] }), true);
  assert.deepEqual(app.window.hidden, []);
});

test('the right click menu offers localized settings and never quits on its own', () => {
  const commands = [];
  const quits = [];
  let shown = 0;
  const template = trayMenuTemplate({
    locale: 'en',
    showWindow: () => { shown += 1; },
    sendCommand: (command) => commands.push(command),
    quit: () => quits.push(true),
  });
  assert.deepEqual(template.map((entry) => entry.label), ['Open Sandkasten', 'Settings', undefined, 'Quit Sandkasten']);
  template[0].click();
  assert.equal(shown, 1);
  const settings = template[1].submenu;
  assert.deepEqual(settings.map((entry) => entry.label), [
    'Setup Guide', 'API Endpoint', undefined, 'Toggle Theme',
  ]);
  for (const entry of settings.filter((item) => item.click)) entry.click();
  assert.deepEqual(commands, ['view.toggleSetup', 'apiEndpoint.open', 'theme.toggle']);
  assert.deepEqual(quits, [], 'only the explicit quit entry may exit');
  template.at(-1).click();
  assert.deepEqual(quits, [true]);
});

test('Chinese tray menus are localized', () => {
  const template = trayMenuTemplate({
    locale: 'zh-CN',
    showWindow: () => {},
    sendCommand: () => {},
    quit: () => {},
  });
  assert.deepEqual(template.map((entry) => entry.label), ['打开 Sandkasten', '设置', undefined, '退出 Sandkasten']);
  assert.deepEqual(template[1].submenu.filter((entry) => entry.click).map((entry) => entry.label), [
    '安装指南', 'API 地址', '切换主题',
  ]);
});

test('closing the window hides it while a real quit is allowed to close', () => {
  const events = new Map();
  const closed = [];
  const window = {
    hide: () => closed.push('hide'),
    on: (event, handler) => events.set(event, handler),
  };
  let quitting = false;
  applyCloseToTrayPolicy({ window, isQuitting: () => quitting });
  const closeEvent = (prevented) => ({
    preventDefault: () => { prevented.value = true; },
  });

  let prevented = { value: false };
  events.get('close')(closeEvent(prevented));
  assert.equal(prevented.value, true, 'a user close must not destroy the window');
  assert.deepEqual(closed, ['hide'], 'the window hides so running tasks keep going');

  quitting = true;
  prevented = { value: false };
  events.get('close')(closeEvent(prevented));
  assert.equal(prevented.value, false, 'the tray quit must be able to close for real');
  assert.deepEqual(closed, ['hide']);
});