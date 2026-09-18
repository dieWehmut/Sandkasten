import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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
    ['config-override.mjs', 'distribution.mjs', 'ipc.mjs', 'isolated-runner.mjs', 'local-runner.mjs', 'menu.mjs', 'navigation.mjs', 'workspace.mjs'],
  );
  for (const name of imports) assert.ok(read(name).length > 0, `${name} must not be empty`);
});