import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { IPC_CHANNELS } from '../src/ipc.mjs';
import { registerTerminalIpc } from '../src/terminal-ipc.mjs';

function harness() {
  const handlers = new Map();
  const calls = [];
  const shortcuts = [];
  const bundledIndex = path.resolve('web-dist/index.html');
  const sender = new EventEmitter();
  sender.mainFrame = { url: `${pathToFileURL(bundledIndex).href}#workspace` };
  sender.isDestroyed = () => false;
  sender.setIgnoreMenuShortcuts = (value) => shortcuts.push(value);
  const window = { webContents: sender, isDestroyed: () => false };
  const event = { sender, senderFrame: sender.mainFrame };
  registerTerminalIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    terminal: Object.fromEntries(['profiles', 'create', 'attach', 'write', 'resize', 'close', 'disposeOwner'].map((method) => [method, (...args) => { calls.push([method, ...args]); return method === 'profiles' ? [{ id: 'cmd', label: 'Command Prompt' }] : undefined; }])),
    getWindowForContents: (contents) => contents === sender ? window : undefined,
    bundledIndex,
  });
  return { calls, shortcuts, sender, window, event, invoke: (channel, request, suppliedEvent = event) => handlers.get(channel)(suppliedEvent, request) };
}

test('only a trusted boolean focus request suppresses native menu shortcuts and navigation restores them', async () => {
  const { invoke, event, sender, shortcuts } = harness();
  await invoke(IPC_CHANNELS.terminalSetFocused, true);
  assert.deepEqual(shortcuts, [true]);
  await assert.rejects(() => invoke(IPC_CHANNELS.terminalSetFocused, 'true'), /boolean/i);
  await assert.rejects(() => invoke(IPC_CHANNELS.terminalSetFocused, false, { ...event, senderFrame: { url: 'https://example.com' } }), /trusted/i);
  assert.deepEqual(shortcuts, [true]);
  sender.emit('did-start-navigation', {}, 'file:///next.html', false, true);
  assert.deepEqual(shortcuts, [true, false]);
  await invoke(IPC_CHANNELS.terminalSetFocused, true);
  sender.emit('render-process-gone');
  assert.deepEqual(shortcuts, [true, false, true, false]);
});

test('terminal IPC accepts only the bundled top-level application frame on every channel', async () => {
  const { event, window, invoke } = harness();
  const channels = ['terminalProfiles', 'terminalCreate', 'terminalAttach', 'terminalWrite', 'terminalResize', 'terminalClose'];
  for (const key of channels) {
    const channel = IPC_CHANNELS[key];
    await assert.rejects(() => invoke(channel, {}, { ...event, senderFrame: { url: event.senderFrame.url } }), /trusted/i);
    const original = event.senderFrame.url;
    event.senderFrame.url = 'https://example.com/';
    await assert.rejects(() => invoke(channel, {}), /trusted/i);
    event.senderFrame.url = original;
  }
  assert.deepEqual(await invoke(IPC_CHANNELS.terminalProfiles), [{ id: 'cmd', label: 'Command Prompt' }]);
  window.isDestroyed = () => true;
  await assert.rejects(() => invoke(IPC_CHANNELS.terminalProfiles), /trusted/i);
});

test('terminal IPC supplies the webContents owner and disposes on reload, crash and destruction', async () => {
  const { sender, calls, invoke } = harness();
  const request = { cols: 80, rows: 24 };
  await invoke(IPC_CHANNELS.terminalCreate, request);
  await invoke(IPC_CHANNELS.terminalAttach, 'session');
  assert.deepEqual(calls, [['create', sender, request], ['attach', sender, 'session']]);
  sender.emit('did-start-navigation', {}, 'file:///index.html#tab', true, true);
  sender.emit('did-start-navigation', {}, 'https://frame.invalid', false, false);
  assert.equal(calls.length, 2, 'hash navigation and subframes keep sessions alive');
  sender.emit('did-start-navigation', {}, 'file:///index.html', false, true);
  sender.emit('render-process-gone');
  sender.emit('destroyed');
  assert.deepEqual(calls.slice(2), Array.from({ length: 3 }, () => ['disposeOwner', sender]));
  assert.equal(sender.listenerCount('did-start-navigation'), 0);
});
