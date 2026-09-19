#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyTerminal } from './e2e-terminal.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(appRoot, '..', '..');
const outputRoot = path.join(repositoryRoot, 'tmp');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'sandkasten-refinement-'));
const workspace = path.join(scratch, 'workspace');
await mkdir(workspace);
await writeFile(path.join(workspace, 'hello.py'), 'print("hello")\n');
await mkdir(outputRoot, { recursive: true });

let driver;
for (const candidate of [
  path.join(appRoot, '..', 'web', 'node_modules', 'playwright-core', 'index.js'),
  path.join(appRoot, 'node_modules', 'playwright-core', 'index.js'),
]) {
  if (!existsSync(candidate)) continue;
  const module = await import(pathToFileURL(candidate).href);
  driver = module._electron ?? module.default?._electron;
  break;
}
if (!driver) throw new Error('Install the WebUI development dependencies before running desktop E2E.');
const packagedExecutable = process.env.SANDKASTEN_E2E_EXECUTABLE;
const executablePath = packagedExecutable ?? (await import('electron')).default;
const app = await driver.launch({
  executablePath,
  args: [...(packagedExecutable ? [] : ['.']), `--user-data-dir=${path.join(scratch, 'profile')}`],
  cwd: appRoot,
  env: { ...process.env, SANDKASTEN_WORKSPACE_ROOT: workspace, SANDKASTEN_API_BASE_URL: 'http://127.0.0.1:1' },
});
const report = { mode: packagedExecutable ? 'packaged' : 'development', setup: [], errors: [] };
try {
  const page = await app.firstWindow();
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.waitForSelector('[data-testid="setup-welcome"]');

  const resize = async (width, height) => {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), [width, height]);
    await page.waitForFunction((expected) => window.outerWidth === expected, width);
  };
  const verifyGuideScroll = async (label) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    const box = await page.locator('[data-testid="setup-welcome"]').boundingBox();
    await page.mouse.move(box.x + box.width / 2, Math.min(300, box.y + 150));
    await page.mouse.wheel(0, 500);
    await page.waitForFunction(() => window.scrollY > 100);
    const scrolled = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 10000);
    await page.waitForFunction(() => {
      const button = document.querySelector('[data-testid="setup-dismiss"]');
      const bounds = button?.getBoundingClientRect();
      return bounds && bounds.top >= 0 && bounds.bottom <= innerHeight;
    });
    report.setup.push({ label, scrolled, bottomActionReachable: true });
  };

  await resize(1440, 900);
  await verifyGuideScroll('first launch desktop');
  await resize(1000, 720);
  await verifyGuideScroll('compact');
  await page.screenshot({ path: path.join(outputRoot, 'desktop-setup-scroll.png') });
  await page.click('[data-testid="setup-dismiss"]');
  await resize(1440, 900);
  await page.waitForSelector('[data-testid="workbench-shell"]');
  await page.click('[data-testid="open-setup-guide"]');
  await verifyGuideScroll('reopened desktop');
  await resize(1000, 720);
  await verifyGuideScroll('reopened compact');
  await page.click('[data-testid="setup-dismiss"]');
  await resize(1440, 900);
  await page.waitForSelector('[data-testid="ide-backend-select"]');
  await page.selectOption('[data-testid="ide-backend-select"]', 'api');
  await page.waitForSelector('.connection-status[data-state="unavailable"]');
  assert.equal(await page.locator('.connection-error').count(), 0, 'the failed runtime connection must not add a banner');
  await page.click('[data-action="open-api-endpoint"]');
  await page.waitForSelector('[role="dialog"]');
  await page.keyboard.press('Escape');
  report.connectionFailureHasNoBanner = true;
  report.endpointSettingsReachable = true;

  while (await page.locator('.ide-tab__close').count()) await page.locator('.ide-tab__close').first().click();
  await page.waitForSelector('[data-testid="editor-welcome"]');
  assert.equal(await page.locator('[data-testid="editor-tabs"]').count(), 0);
  assert.equal(await page.locator('[data-testid="ide-backend-select"]').count(), 0);
  await page.click('[data-action="ide-collapse-sidebar"]');
  await page.click('[data-action="welcome-new-file"]');
  await page.waitForSelector('[data-testid="ide-new-file-form"]');
  await page.locator('[data-testid="ide-new-file-form"] input').fill('welcome.py');
  await page.click('[data-action="ide-create-file"]');
  await page.waitForSelector('[data-action="ide-tab-welcome.py"]');
  await page.click('[data-action="ide-close-welcome.py"]');
  await page.waitForSelector('[data-testid="editor-welcome"]');
  await page.click('[data-action="welcome-open-setup"]');
  await page.waitForSelector('[data-testid="setup-welcome"]');
  await page.click('[data-testid="setup-dismiss"]');
  for (const theme of ['light', 'dark']) {
    if (await page.getAttribute('html', 'data-theme') !== theme) {
      await page.click('[data-action="toggle-theme"]');
      await page.waitForFunction((value) => document.documentElement.dataset.theme === value, theme);
    }
    await page.screenshot({ path: path.join(outputRoot, `desktop-welcome-${theme}.png`) });
  }
  report.welcome = { createFile: true, restoreAfterLastTab: true, setupAction: true };
  report.terminal = await verifyTerminal({ page, app, outputRoot });
  assert.deepEqual(report.errors, [], 'the renderer must not raise uncaught errors');
} catch (error) {
  report.failure = error.stack ?? String(error);
  throw error;
} finally {
  await writeFile(path.join(outputRoot, 'desktop-refinement-e2e.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  await app.close();
  // scratch is created by mkdtemp and contains only this run's workspace/profile.
  await rm(scratch, { recursive: true, force: true, maxRetries: 3 });
}
