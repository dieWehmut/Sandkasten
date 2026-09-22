#!/usr/bin/env node
// Open one file per common language in the real shell and record how many
// distinct token colors the editor paints. A file that renders one color is
// plain text, whatever its extension says.
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const appRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..');
const repositoryRoot = path.resolve(appRoot, '..', '..');
const outputRoot = path.join(repositoryRoot, 'tmp', 'highlight-probe');
await mkdir(outputRoot, { recursive: true });

async function loadElectronDriver() {
  const candidates = [
    path.join(appRoot, '..', 'web', 'node_modules', 'playwright-core', 'index.js'),
    path.join(appRoot, 'node_modules', 'playwright-core', 'index.js'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      const module = await import(pathToFileURL(candidate).href);
      return module._electron ?? module.default?._electron ?? module.default;
    }
  }
  throw new Error('playwright-core is required');
}
const electron = await loadElectronDriver();

const workspace = await mkdtemp(path.join(os.tmpdir(), 'sandkasten-hl-'));
const samples = {
  'main.py': 'def greet(name):' + String.fromCharCode(10) + '    """Doc."""' + String.fromCharCode(10) + '    return f"hi {name}"' + String.fromCharCode(10),
  'app.ts': '// comment' + String.fromCharCode(10) + 'export const value: number = 42;' + String.fromCharCode(10) + 'export function run(): string { return "ok"; }' + String.fromCharCode(10),
  'notes.md': '# Title' + String.fromCharCode(10) + String.fromCharCode(10) + '- item with **bold**' + String.fromCharCode(10) + String.fromCharCode(10) + '> quote' + String.fromCharCode(10),
  'styles.css': '/* comment */' + String.fromCharCode(10) + '.card {' + String.fromCharCode(10) + '  color: #ff0000;' + String.fromCharCode(10) + '  margin: 4px;' + String.fromCharCode(10) + '}' + String.fromCharCode(10),
  'page.html': '<!doctype html>' + String.fromCharCode(10) + '<html><body class="page"><h1>Hi</h1></body></html>' + String.fromCharCode(10),
  'config.yaml': 'name: sandkasten' + String.fromCharCode(10) + 'count: 3' + String.fromCharCode(10) + 'nested:' + String.fromCharCode(10) + '  enabled: true' + String.fromCharCode(10),
  'query.sql': 'SELECT id, name FROM users WHERE id = 1;' + String.fromCharCode(10),
  'run.sh': '#!/bin/bash' + String.fromCharCode(10) + 'for f in *.py; do' + String.fromCharCode(10) + '  echo "found $f"' + String.fromCharCode(10) + 'done' + String.fromCharCode(10),
  'lib.rs': '// comment' + String.fromCharCode(10) + 'pub fn add(a: i32, b: i32) -> i32 { a + b }' + String.fromCharCode(10),
  'data.json': '{"name": "sandkasten", "count": 3, "ok": true}' + String.fromCharCode(10),
  'app.vue': '<script setup>' + String.fromCharCode(10) + 'const count = 1' + String.fromCharCode(10) + '</scr' + 'ipt>' + String.fromCharCode(10) + '<template><p>{{ count }}</p></template>' + String.fromCharCode(10),
};
for (const [name, body] of Object.entries(samples)) await writeFile(path.join(workspace, name), body);

const executable = process.env.SANDKASTEN_E2E_EXECUTABLE;
const electronExecutable = executable
  ?? (await import(pathToFileURL(path.join(appRoot, 'node_modules', 'electron', 'index.js')).href)).default;
const profileArgument = '--user-data-dir=' + path.join(workspace, '..', 'profile');
const app = await electron.launch({
  executablePath: electronExecutable,
  args: executable ? [profileArgument] : [appRoot, profileArgument],
  env: { ...process.env, SANDKASTEN_WORKSPACE_ROOT: workspace, SANDKASTEN_E2E_PROBE: '1' },
  cwd: appRoot,
});
const page = await app.firstWindow();
await page.waitForSelector('[data-testid="app-shell"]', { timeout: 30000 });
if (await page.locator('[data-testid="setup-dismiss"]').count()) await page.click('[data-testid="setup-dismiss"]');
await page.waitForSelector('[data-testid="workspace-explorer"]', { timeout: 30000 });

const report = { workspace, files: [] };
for (const name of Object.keys(samples)) {
  await page.click('[data-path="' + name + '"] .ide-tree__open');
  await page.waitForSelector('.cm-content', { timeout: 15000 });
  await page.waitForTimeout(350);
  const tokens = await page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('.cm-content .cm-line span'));
    const colors = new Set();
    for (const span of spans) {
      const color = getComputedStyle(span).color;
      if (span.textContent.trim()) colors.add(color);
    }
    return { spans: spans.length, colors: [...colors] };
  });
  report.files.push({ name, spans: tokens.spans, distinctColors: tokens.colors.length, colors: tokens.colors.slice(0, 6) });
  await page.keyboard.press('Control+w');
  await page.waitForTimeout(150);
}
await app.close();
process.stdout.write(JSON.stringify(report, null, 1) + String.fromCharCode(10));
