import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(root);
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Vue foundation source files and deployment entrypoint exist', () => {
  for (const file of ['index.html', 'public/config.js', 'src/App.vue', 'src/main.ts', 'src/services/sandkastenApi.ts']) {
    assert.equal(fs.existsSync(path.join(root, file)), true, `${file} should exist`);
  }
  const html = read('index.html');
  assert.ok(html.indexOf('src="./config.js"') < html.indexOf('src="./src/main.ts"'));
  assert.match(read('src/main.ts'), /createApp\(App\)\.mount\('#app'\)/);
  assert.match(read('src/App.vue'), /data-testid="app-shell"/);
});

test('runtime config preserves nullish assignment and same-origin default', () => {
  const source = read('public/config.js');
  assert.match(source, /globalThis\.SANDKASTEN_CONFIG \?\?= \{ apiBaseUrl: '' \};/);
  const context = {};
  vm.runInNewContext(source, context);
  assert.equal(context.SANDKASTEN_CONFIG.apiBaseUrl, '');
  const existing = { apiBaseUrl: 'https://api.example.test' };
  vm.runInNewContext(source, { SANDKASTEN_CONFIG: existing });
  assert.equal(existing.apiBaseUrl, 'https://api.example.test');
});

test('API source preserves HTTP contract, polling semantics, and text-only output fallback', () => {
  const source = read('src/services/sandkastenApi.ts');
  assert.match(source, /Accept: 'application\/json'/);
  assert.match(source, /JSON\.stringify\(\{ source, wait: false \}\)/);
  assert.match(source, /JOB_STATUS_SUCCEEDED/);
  assert.match(source, /JOB_STATUS_SYSTEM_ERROR/);
  assert.match(source, /TextDecoder\('utf-8', \{ fatal: true \}\)/);
  assert.match(source, /return \{ text: raw, raw, undecodable: true/);
  const design = fs.readFileSync(path.join(repoRoot, 'docs/superpowers/specs/2026-08-20-vue-webui-redesign-design.md'), 'utf8');
  assert.match(design, /\*\*Stop polling\*\*/);
  assert.match(design, /The UI never claims[\s\S]*backend job was\s+canceled\./);
});
