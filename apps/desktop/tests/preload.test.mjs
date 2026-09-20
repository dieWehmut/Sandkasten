import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import { IPC_CHANNELS } from '../src/ipc.mjs';

const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

function read(fileName) {
  return readFileSync(path.join(sourceDirectory, fileName), 'utf8');
}

test('the preload stays CommonJS because sandboxed preloads cannot be ES modules', () => {
  const preload = read('preload.cjs');
  assert.match(preload, /require\('electron'\)/);
  assert.doesNotMatch(preload, /^\s*import\s/m, 'sandboxed preloads must not use import statements');
  assert.match(preload, /contextBridge\.exposeInMainWorld\('sandkastenDesktop'/);
  assert.equal((preload.match(/exposeInMainWorld\(/g) ?? []).length, 1, 'only the sandkastenDesktop bridge may be exposed');
  assert.doesNotMatch(preload, /exposeInMainWorld\('ipcRenderer'/, 'the raw ipcRenderer must never reach the renderer');
});

test('preload channels match the main-process IPC registry', () => {
  const channels = new Set(read('ipc.mjs').match(/'sandkasten:[a-z-]+:[a-z-]+'/g) ?? []);
  assert.ok(channels.size >= 10, 'the IPC registry should declare every desktop channel');
  const preload = read('preload.cjs');
  for (const channel of channels) {
    assert.ok(preload.includes(channel), `preload.cjs must forward ${channel}`);
  }
  for (const match of preload.match(/'sandkasten:[a-z-]+:[a-z-]+'/g) ?? []) {
    assert.ok(channels.has(match), `preload.cjs declares an unknown channel: ${match}`);
  }
});

test('the main process points at the CommonJS preload', () => {
  const main = read('main.mjs');
  assert.match(main, /'preload\.cjs'/);
  assert.doesNotMatch(main, /'preload\.mjs'/);
});

test('every desktop module the main process imports exists', () => {
  const main = read('main.mjs');
  const imports = Array.from(main.matchAll(/from '\.\/([\w.-]+)'/g), (match) => match[1]);
  assert.deepEqual(
    imports.slice().sort(),
    ['config-override.mjs', 'distribution.mjs', 'ipc.mjs', 'isolated-runner.mjs', 'local-runner.mjs', 'menu.mjs', 'navigation.mjs', 'terminal-ipc.mjs', 'terminal-profiles.mjs', 'terminal-pty.mjs', 'terminal.mjs', 'tray.mjs', 'updates.mjs', 'workspace.mjs'],
  );
  for (const name of imports) assert.ok(read(name).length > 0, `${name} must not be empty`);
});

test('terminal bridge supports attach and removable subscriptions without exposing Electron events', async () => {
  let bridge;
  const calls = [];
  const listeners = new Map();
  runInNewContext(read('preload.cjs'), {
    process: { platform: 'win32', versions: {} },
    require: () => ({
      contextBridge: { exposeInMainWorld: (_key, value) => { bridge = value; } },
      ipcRenderer: {
        invoke: async (...args) => calls.push(args),
        on: (channel, listener) => listeners.set(channel, listener),
        removeListener: (channel, listener) => { if (listeners.get(channel) === listener) listeners.delete(channel); },
      },
    }),
  });
  assert.ok(bridge.terminal, 'desktop must expose the terminal capability');
  await bridge.terminal.attach('id-1');
  assert.deepEqual(calls, [[IPC_CHANNELS.terminalAttach, 'id-1']]);
  const received = [];
  const unsubscribeData = bridge.terminal.onData((...args) => received.push(args));
  const unsubscribeExit = bridge.terminal.onExit((...args) => received.push(args));
  listeners.get(IPC_CHANNELS.terminalData)({ secret: 'ipc event' }, { id: 'id-1', data: 'prompt' });
  listeners.get(IPC_CHANNELS.terminalExit)({ secret: 'ipc event' }, { id: 'id-1', exitCode: 0 });
  assert.deepEqual(received, [[{ id: 'id-1', data: 'prompt' }], [{ id: 'id-1', exitCode: 0 }]]);
  unsubscribeData();
  unsubscribeExit();
  assert.equal(listeners.size, 0);
});

test('the sandbox exposes only narrow promise-based window chrome operations', async () => {
  let bridge;
  const calls = [];
  runInNewContext(read('preload.cjs'), {
    process: { platform: 'win32', versions: { chrome: 'test', electron: 'test' } },
    require(name) {
      assert.equal(name, 'electron');
      return {
        contextBridge: { exposeInMainWorld: (key, value) => { assert.equal(key, 'sandkastenDesktop'); bridge = value; } },
        ipcRenderer: { invoke: async (...args) => { calls.push(args); }, on: () => {} },
      };
    },
  });
  assert.ok(bridge.windowChrome, 'the renderer can detect integrated chrome');
  assert.equal(bridge.windowChrome.integrated, true);
  assert.deepEqual(Object.keys(bridge.windowChrome).sort(), ['integrated', 'setTheme', 'showMenu']);
  await bridge.windowChrome.setTheme('dark');
  const request = { id: 'edit', locale: 'en', x: 120, y: 40 };
  await bridge.windowChrome.showMenu(request);
  assert.deepEqual(calls, [[IPC_CHANNELS.chromeSetTheme, 'dark'], [IPC_CHANNELS.chromeShowMenu, request]]);
  assert.equal(bridge.ipcRenderer, undefined);
  assert.equal(bridge.invoke, undefined);
});
