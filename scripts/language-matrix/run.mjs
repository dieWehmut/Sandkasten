#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createLocalRunner, LOCAL_RUNTIMES } from '../../apps/desktop/src/local-runner.mjs';
import { FIXTURES } from './fixtures.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
assert.ok(process.env.CONDA_PREFIX, 'Activate the dedicated conda environment before running this matrix');
assert.match(os.release(), /microsoft.*WSL/i, 'Run the matrix in local WSL');
assert.ok(process.execPath.startsWith(`${process.env.CONDA_PREFIX}/`), 'Use the Node executable inside the active Conda environment');
// WSL can append Windows executables after Linux paths. Some Linux tools (for
// example Crystal's pkg-config lookup) still probe those paths and fail on a
// transient Windows mount I/O error, so keep this matrix inside Linux paths.
const matrixPath = process.env.PATH.split(path.delimiter)
  .filter((entry) => !/^\/mnt\/[a-z](?:\/|$)/i.test(entry))
  .join(path.delimiter);
const matrixEnv = { ...process.env, PATH: matrixPath };
const environment = { platform: process.platform, release: os.release(), hostname: os.hostname(), condaPrefix: process.env.CONDA_PREFIX, node: process.version, nodeExecutable: process.execPath, path: matrixPath };
const out = path.resolve(root, process.env.SANDKASTEN_MATRIX_OUTPUT ?? '.sandkasten/language-matrix');
await mkdir(out, { recursive: true });
// Invalidate a previous success before detection or execution can be interrupted.
await writeFile(path.join(out, 'summary.json'), JSON.stringify({ startedAt: new Date().toISOString(), expected: 58, tested: 0, passed: 0, failed: 0, completeMatrix: false, all58Passed: false }, null, 2));
const selected = (process.env.SANDKASTEN_MATRIX_LANGUAGES ?? Object.keys(FIXTURES).join(',')).split(',');
assert.equal(Object.keys(LOCAL_RUNTIMES).length, 58, 'The canonical matrix must cover 58 languages');
assert.equal(new Set(selected).size, selected.length, 'Duplicate languages are not allowed');
assert.deepEqual(Object.keys(FIXTURES).sort(), Object.keys(LOCAL_RUNTIMES).sort());
const runner = createLocalRunner({ env: matrixEnv, tmpRoot: path.join(out, 'build'), probeTimeoutMs: 15_000 });
const detected = await runner.detect();
for (const entry of detected) {
  entry.executable = spawnSync('/bin/sh', ['-c', 'command -v "$1"', 'matrix', entry.command], { encoding: 'utf8', env: matrixEnv }).stdout.trim();
}
await writeFile(path.join(out, 'environment.json'), JSON.stringify({ ...environment, detected }, null, 2));
let browser;
const results = [];
async function browserFor() {
  if (browser) return browser;
  const require = createRequire(path.join(root, 'apps/web/package.json'));
  const { chromium } = require('playwright-core');
  const executable = process.env.SANDKASTEN_CHROMIUM ?? '/home/han/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
  browser = await chromium.launch({ executablePath: executable, headless: true, env: { ...matrixEnv, LD_LIBRARY_PATH: `${process.env.CONDA_PREFIX}/lib${process.env.LD_LIBRARY_PATH ? ':' + process.env.LD_LIBRARY_PATH : ''}` } });
  return browser;
}
for (const language of selected) {
  const fixture = FIXTURES[language];
  assert.ok(fixture, `Unknown language: ${language}`);
  const workspace = path.join(out, 'workspaces', language);
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(workspace, fixture.file), fixture.source);
  const availability = detected.find((entry) => entry.language === language);
  // Attempt execution even when a version probe fails; its outcome is recorded.
  const result = await runner.run({ jobId: `matrix-${language}`, path: fixture.file, language, timeoutMs: 120_000 }, { root: workspace });
  const row = { language, kind: fixture.kind, probe: availability, passed: false, result };
  try {
    assert.equal(result.status, 'JOB_STATUS_SUCCEEDED', result.errorMessage ?? result.stderr ?? result.compileStderr);
    for (const expected of Array.isArray(fixture.expected) ? fixture.expected : [fixture.expected]) assert.ok(result.stdout.includes(expected), `Missing output: ${expected}`);
    if (['web', 'style', 'document'].includes(fixture.kind)) {
      const browser = await browserFor();
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const html = fixture.kind === 'style' ? `<style>${result.stdout}</style><main class="text-red-500 font-bold">Style preview: ${language}</main>` : result.stdout;
      await page.setContent(html);
      if (fixture.kind === 'document') assert.ok(await page.locator('svg').count());
      else if (fixture.kind === 'style') {
        const color = await page.locator('main').evaluate((el) => getComputedStyle(el).color);
        assert.equal(color, language === 'tailwindcss' ? 'rgb(239, 68, 68)' : 'rgb(15, 118, 110)');
      } else {
        assert.ok((await page.locator('body').innerText()).trim().length > 0);
        if (language === 'html') assert.equal(await page.locator('main').getAttribute('data-executed'), 'yes');
      }
      await page.screenshot({ path: path.join(out, `${language}-wide.png`), fullPage: true });
      await page.setViewportSize({ width: 640, height: 480 });
      await page.screenshot({ path: path.join(out, `${language}-compact.png`), fullPage: true });
      row.browser = { verified: true, screenshots: [`${language}-wide.png`, `${language}-compact.png`] };
      await page.close();
    }
    row.passed = true;
  } catch (error) { row.failure = error.message; }
  results.push(row);
  await writeFile(path.join(out, `${language}.json`), JSON.stringify(row, null, 2));
  await writeFile(path.join(out, 'results.json'), JSON.stringify({ ...environment, checkedAt: new Date().toISOString(), results }, null, 2));
  console.log(`${row.passed ? 'PASS' : 'FAIL'} ${language}: ${row.failure ?? `${result.durationMs}ms`}`);
}
await browser?.close();
const passed = results.filter((row) => row.passed).length;
const completeMatrix = results.length === 58 && new Set(results.map((row) => row.language)).size === 58;
await writeFile(path.join(out, 'summary.json'), JSON.stringify({ checkedAt: new Date().toISOString(), expected: 58, tested: results.length, passed, failed: results.length - passed, completeMatrix, all58Passed: completeMatrix && passed === 58 }, null, 2));
console.log(`${passed}/${results.length} real language cases passed; complete 58-language matrix: ${completeMatrix}; evidence: ${out}`);
process.exitCode = passed === results.length ? 0 : 1;
